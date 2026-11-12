import { readdir, readFile, stat, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { estadoCobro } from '../lib/estado-cobro.mjs';
import { loadWorkbook } from '../lib/load-workbook.ts';
import { argentinaToday, evaluate } from '../lib/reader.ts';
import { family, isConflict, snapshot, resolveFamily } from '../lib/conflict.mjs';

const [folder, output, mode] = process.argv.slice(2);
if (!folder || !output) throw new Error('Indicá la carpeta de fichas y la ruta del panel HTML.');
const cache=new Map();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(n);

async function scan(){
  const today=argentinaToday(), rows=[], notices=[], groups=new Map(), months=new Set([today.slice(0,7)]);
  let entries=[], validations={}, directoryAvailable=true;
  try { entries=await readdir(folder,{withFileTypes:true}); }
  catch(e){ directoryAvailable=false; notices.push('No se pudo leer la carpeta de fichas. Verificá que esté disponible y que el actualizador tenga permiso de lectura.'); }
  try { validations=JSON.parse(await readFile(path.join(path.dirname(output),'validaciones.json'),'utf8')); }
  catch(e){ if(e.code!=='ENOENT') notices.push('No se pudieron leer las validaciones guardadas. Revisá validaciones.json.'); }
  const names=entries.filter(e=>e.isFile() && !e.name.startsWith('~$') && /\.xls[xm]?$/i.test(e.name)).map(e=>e.name).sort();
  for(const name of names){
    const file={name};
    try {
      const location=path.join(folder,name), info=await stat(location);
      file.modified=info.mtime;
      const version=[info.ino,info.size,info.ctimeMs,info.mtimeMs].join(':');
      if(cache.get(name)?.version!==version){
        if(info.size>15*1024*1024) throw new Error('Supera 15 MB.');
        let cells;
        const reading=await loadWorkbook(name,await readFile(location),{},sheets=>{cells=snapshot(sheets)});
        cache.set(name,{version,reading,cells});
      }
      Object.assign(file,cache.get(name));
    } catch(e){file.error=e.path?'No se pudo leer el archivo ('+(e.code || 'error')+').':e.message;}
    const key=family(name);
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(file);
  }
  for(const name of cache.keys()) if(!names.includes(name)) cache.delete(name);
  for(const [key,files] of groups){
    const {winner,reason}=resolveFamily(files);
    const versions=files.map(f=>f.name+' ('+(f.modified?.toLocaleString('es-AR')??'fecha desconocida')+')').join(' / ');
    if(reason) notices.push(versions+' — '+reason+(winner?' Se usa '+winner.name+'.':' Sin sumar importes.'));
    if(!winner){rows.push(row('*',key,'REVISAR','—',[reason]));continue;}
    const r={...winner.reading};
    if(isConflict(winner.name)) r.issues=r.issues.filter(i=>!i.startsWith('Archivo identificado como copia en conflicto de Dropbox.'));
    const blocks=r.blocks.filter(b=>b.start===r.currentStart && b.end===r.currentEnd);
    if(blocks.length!==1){rows.push(row('*',r.identity,'REVISAR','—',[winner.name,...r.issues,'No se identificó un único bloque correspondiente al contrato actual.']));continue;}
    const block=blocks[0];
    for(const period of block.periods){
      months.add(period.key);
      const id=block.id+'|'+period.key, v=validations?.[id];
      const valid=v?.identityConfirmed===true && v?.windowConfirmed===true && typeof v?.reference==='string' && Number.isFinite(v.expected);
      const result=evaluate(r,block,period,today,valid?{...v,paymentConfirmed:v.paymentConfirmed===true}:undefined);
      const status=estadoCobro(result,period,v);
      const confirmed=status==='PAGADO' && result.status!=='PAGADO';
      const evidence=period.movements.map(m=>[m.date??'Sin fecha',m.amount===null?'Sin importe':money(m.amount),m.receipt?'Recibo '+m.receipt:'Sin recibo',m.evidence.map(e=>e.sheet+'!'+e.cell).join(', ')].join(' · '));
      const accepted = period.movements.filter(m=>m.recorded && m.date && m.date<=today && m.amount>0);
      const paymentDates = accepted.map(m=>dayMonthYear(m.date)+' · '+money(m.amount));
      const window = paymentWindow(period, r.window, result.dueDate);
      const collection = accepted.length ? 'registrado' : period.movements.length ? 'incierto' : 'sin-registro';
      rows.push(row(period.key,r.identity,status,money(result.recorded),[winner.name,r.address,...(files.length===1 && isConflict(winner.name)?['Ficha vigente: única versión disponible en la carpeta.']:[]),...evidence,...(confirmed?['Liquidación confirmada: '+v.liquidacion.referencia]:result.issues),...(valid?['Referencia: '+v.reference,'Exigible: '+money(v.expected)]:[]),'ID para validar: '+id], {paymentDates, window, collection, address:r.address}));
    }
  }
  const html = renderDashboard({today, months, rows, notices, totalFiles:names.length, totalFamilies:groups.size, directoryAvailable});
  await writeFile(output+'.tmp',html,{mode:0o600});await rename(output+'.tmp',output);
}
function dayMonthYear(iso) {
  return iso.split('-').reverse().join('/');
}

function paymentWindow(period, window, dueDate) {
  if (!window || !dueDate) return 'Sin identificar';
  const [year, month] = period.start.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const opens = period.start.slice(0, 7)+'-'+String(Math.min(window[0], lastDay)).padStart(2,'0');
  return dayMonthYear(opens)+' al '+dayMonthYear(dueDate);
}

function row(month, identity, status, amount, notes, options={}) {
  const {paymentDates=[], window='Sin identificar', collection='incierto', address=''}=options;
  const tone=status==='PAGADO'?'paid':status==='PAGO PARCIAL'?'partial':status==='REVISAR'?'review':'neutral';
  const dates=paymentDates.length?paymentDates.map(payment=>'<div>'+esc(payment)+'</div>').join(''):
    collection==='sin-registro'?'Sin cobro registrado':'Sin cobro verificable';
  return `<tr data-month="${esc(month)}" data-status="${esc(status)}" data-collection="${collection}">
  <td data-label="Ficha"><strong>${esc(identity)}</strong>${address?'<small>'+esc(address)+'</small>':''}</td>
  <td data-label="Cobrado">${esc(amount)}</td><td data-label="Fecha e importe de cada cobro">${dates}</td>
  <td data-label="Ventana según ficha">${esc(window)}</td><td data-label="Estado"><span class="pill ${tone}">${esc(status)}</span>
  <details><summary>Ver evidencia</summary>${notes.map(n=>'<p>'+esc(n)+'</p>').join('')}</details></td></tr>`;
}

function renderDashboard({today,months,rows,notices,totalFiles,totalFamilies,directoryAvailable}) {
  const generatedAt=Date.now();
  const timestamp=new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Mendoza',dateStyle:'short',timeStyle:'medium'}).format(generatedAt);
  const statuses=['PAGADO','COBRO REGISTRADO','PAGO PARCIAL','SIN COBRO REGISTRADO — PLAZO VENCIDO','EN PLAZO','PRÓXIMO','REVISAR'];
  const periods=[...months].sort().reverse().map(m=>{
    const date = new Date(m+'-15T12:00:00Z');
    const label = new Intl.DateTimeFormat('es-AR',{month:'long',year:'numeric',timeZone:'UTC'}).format(date);
    return '<option value="'+esc(m)+'" '+(m===today.slice(0,7)?'selected':'')+'>'+esc(label)+'</option>';
  }).join('');
  return `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Control diario de alquileres</title>
  <style>
  *{box-sizing:border-box}body{font:16px/1.45 system-ui,sans-serif;color:#18363d;background:#f6f8f8;margin:0}main{max-width:1350px;margin:auto;padding:24px}h1{margin:0;font-size:clamp(1.7rem,4vw,2.3rem)}header p{margin:.4em 0}.filters,.stats{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}.filters label{display:grid;gap:3px;font-size:.85rem;font-weight:600}select,input{font:inherit;padding:9px;border:1px solid #b1c3c7;border-radius:5px;background:white;color:inherit;max-width:100%}.stats div{border:1px solid #cfdcdd;background:white;min-width:140px;padding:12px 16px;border-radius:8px}.stats b{display:block;font-size:1.5rem}h2{font-size:1.14rem;margin:22px 0 0}table{width:100%;border-collapse:collapse;background:white}th,td{text-align:left;padding:12px;vertical-align:top;border-bottom:1px solid #dde4e2}th{background:#e7eff0;font-size:.9rem}small{display:block;color:#53666c}summary{cursor:pointer;color:#115860}.pill{display:inline-block;border-radius:5px;padding:3px 8px;font-size:.8rem;font-weight:650;background:#e9eff1}.paid{background:#d4f2e3;color:#175c3e}.partial,.review{background:#fff0d2;color:#75500e}details p{overflow-wrap:anywhere}aside{padding:10px;background:#fff2d7;border-radius:6px;margin:12px 0}.count{margin:8px 0}[hidden]{display:none!important}
  @media(max-width:850px){main{padding:14px}.filters label{flex:1 1 130px}.stats{gap:6px}.stats div{flex:1 1 100px;min-width:0;font-size:.82rem;padding:8px}.stats b{font-size:1.15rem}table,tbody{display:block;background:transparent}thead{display:none}tr{display:block;background:white;margin:12px 0;border:1px solid #d5e0e2;border-radius:8px;padding:8px}td{display:block;padding:5px 9px;border:0}td::before{content:attr(data-label);display:block;color:#53666c;font-size:.77rem}td details{margin-top:4px}}
  </style></head><body><main><header><h1>Control diario de alquileres</h1><p>Lectura de las fichas: ${esc(timestamp)} (Mendoza) · ${totalFiles} archivos · ${totalFamilies} fichas agrupadas</p><!--scaffidi-sync-status--><small id="fresh" role="status"></small></header>
  ${notices.length?'<aside><details><summary>Archivos y versiones que requieren atención ('+notices.length+')</summary>'+notices.map(n=>'<p>'+esc(n)+'</p>').join('')+'</details></aside>':''}
  <div class="filters"><label>Período de alquiler<select id="month">${periods}</select></label><label>Movimientos<select id="collection"><option value="todos">Todos</option><option value="registrado">Con cobro registrado</option><option value="sin-registro">Sin cobro registrado</option><option value="incierto">Sin datos suficientes</option></select></label>
  <label>Estado del período<select id="status"><option>Todos</option>${statuses.map(s=>'<option>'+esc(s)+'</option>').join('')}</select></label><label>Buscar ficha<input id="search" type="search" placeholder="Titular, inmueble o recibo"></label></div>
  <h2>Resumen del período</h2><div class="stats"><div><b id="received">0</b>Con cobro registrado</div><div><b id="paid">0</b>Pagado confirmado</div><div><b id="missing">0</b>Sin cobro registrado</div><div><b id="unclear">0</b>Sin datos suficientes</div></div>
  <p id="count" class="count" aria-live="polite"></p><table><thead><tr><th>Titular según ficha</th><th>Cobrado</th><th>Fecha e importe de cada cobro</th><th>Ventana según ficha</th><th>Estado y evidencia</th></tr></thead><tbody>${rows.join('')}</tbody></table></main>
  <script>
  const fields=['month','collection','status','search'].map(id=>document.getElementById(id));
  const [period,collection,status,search]=fields;
  const rows=Array.from(document.querySelectorAll('tr[data-month]'));
  const saved=new URLSearchParams(location.hash.slice(1));
  for(const field of fields)if(saved.has(field.id)&&(field.tagName!=='SELECT'||Array.from(field.options).some(o=>o.value===saved.get(field.id))))field.value=saved.get(field.id);
  function filter(){
    let visible=0,received=0,paid=0,missing=0,unclear=0;
    const q=search.value.trim().toLocaleLowerCase('es');
    for(const row of rows){
      const inPeriod=row.dataset.month===period.value||row.dataset.month==='*';
      if(inPeriod){
        if(row.dataset.collection==='registrado')received++;
        else if(row.dataset.collection==='sin-registro')missing++;
        else unclear++;
        if(row.dataset.status==='PAGADO')paid++;
      }
      row.hidden=!inPeriod || (collection.value!=='todos' && row.dataset.collection!==collection.value) ||
        (status.value!=='Todos' && row.dataset.status!==status.value) || (q&&!row.textContent.toLocaleLowerCase('es').includes(q));
      if(!row.hidden)visible++;
    }
    for(const [id,value] of Object.entries({received,paid,missing,unclear}))document.getElementById(id).textContent=value;
    document.getElementById('count').textContent=visible===1?'1 fila visible':visible+' filas visibles';
  }
  for(const field of fields)field.oninput=()=>{filter();location.replace('#'+new URLSearchParams(fields.map(f=>[f.id,f.value])))};
  function freshness(){if(document.getElementById('sync-remota')||${process.env.SC_PANEL_SOURCE==='dropbox'?'true':'false'})return;document.getElementById('fresh').textContent=${directoryAvailable?'true':'false'}?
    Date.now()-${generatedAt}>120000?'Lectura desactualizada. Verificá el actualizador y la sincronización de la carpeta.':'Origen: carpeta del actualizador. El panel se recarga cada minuto.':
    'La última lectura falló. Verificá la carpeta de origen.';}
  filter();freshness();setInterval(freshness,10000);setTimeout(()=>location.reload(),60000);
  </script></body></html>`;
}

do{await scan();if(mode==='--una-vez') break;await new Promise(resolve=>setTimeout(resolve,60000));}while(true);
