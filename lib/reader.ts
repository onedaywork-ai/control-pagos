export type Cell = { ref:string; value?:string|number|boolean; type?:string; formula?:string };
export type Sheet = { name:string; cells:Cell[] };
export type SourceBook = { name:string; fingerprint:string; sheets:Sheet[]; sourceId?:string; sourcePath?:string; sourceUrl?:string; sourceModified?:string };
export type Evidence = { sheet:string; cell:string; value:string|number|boolean|null; formula?:string };
export type Movement = { id:string; row:number; amount:number|null; date:string|null; receipt:string; evidence:Evidence[]; issues:string[]; recorded:boolean };
export type Period = { key:string; label:string; sequence:number; start:string; end:string; movements:Movement[]; issues:string[]; evidence:Evidence[]; amountMentioned:number|null; amountEvidence:Evidence[] };
export type ContractBlock = { id:string; start:string; end:string; sheet:string; header:string; periods:Period[]; issues:string[] };
export type Reading = { schemaVersion:1; source:Omit<SourceBook,'sheets'>; identity:string; address:string; currentStart:string|null; currentEnd:string|null; window:[number,number]|null; evidence:Evidence[]; blocks:ContractBlock[]; issues:string[] };
export type Validation = { expected:number; identityConfirmed:boolean; windowConfirmed:boolean; reference:string; paymentConfirmed?:boolean };
export type Evaluation = { status:'PAGADO'|'EN PLAZO'|'SIN COBRO REGISTRADO — PLAZO VENCIDO'|'PAGO PARCIAL'|'REVISAR'|'PRÓXIMO'; recorded:number; expected:number|null; balance:number|null; issues:string[]; dueDate:string|null };
const MONTHS:Record<string,number>={ENE:1,ENERO:1,FEB:2,FEBRERO:2,MAR:3,MARZO:3,ABR:4,ABRIL:4,MAY:5,MAYO:5,JUN:6,JUNIO:6,JUL:7,JULIO:7,AGO:8,AGOSTO:8,SET:9,SEP:9,SEPT:9,SETIEMBRE:9,SEPTIEMBRE:9,OCT:10,OCTUBRE:10,NOV:11,NOVIEMBRE:11,DIC:12,DICIEMBRE:12};
const pad=(n:number)=>String(n).padStart(2,'0');
const norm=(v:unknown)=>String(v??'').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
const row=(ref:string)=>Number(ref.match(/\d+$/)?.[0]);
const column=(ref:string)=>ref.replace(/\d+$/,'');
function colNumber(s:string){let n=0;for(const c of s)n=n*26+c.charCodeAt(0)-64;return n-1;}
function colName(n:number){let out='';for(n++;n>0;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;}
export function parseDate(value:unknown):string|null {
 const s=String(value??'').trim();let y:number,m:number,d:number;let a=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
 if(a){y=+a[1];m=+a[2];d=+a[3];}else{a=s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);if(!a)return null;d=+a[1];m=+a[2];y=+a[3];}
 const dt=new Date(Date.UTC(y,m-1,d));return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d&&y>=1900&&y<=2200?`${y}-${pad(m)}-${pad(d)}`:null;
}
export function parseMoney(value:unknown):number|null {
 if(typeof value==='number')return Number.isFinite(value)&&Number.isSafeInteger(Math.round(value*100))?Math.round(value*100)/100:null;
 let s=String(value??'').trim().replace(/^(?:ARS|\$)\s*/i,'').replace(/\s/g,'');if(!s)return null;
 if(/^-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s))s=s.replace(/\./g,'').replace(',','.');
 else if(/^-?\d+(?:,\d{1,2})?$/.test(s))s=s.replace(',','.');else if(!/^-?\d+\.\d{1,2}$/.test(s))return null;
 const n=Number(s);return Number.isFinite(n)&&Number.isSafeInteger(Math.round(n*100))?Math.round(n*100)/100:null;
}
export function argentinaToday(date=new Date()):string{return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Mendoza',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function addMonths(iso:string,n:number){const [y,m,d]=iso.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1+n,1));const last=new Date(Date.UTC(dt.getUTCFullYear(),dt.getUTCMonth()+1,0)).getUTCDate();return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth()+1)}-${pad(Math.min(d,last))}`;}
function previousDay(iso:string){const dt=new Date(iso+'T12:00:00Z');dt.setUTCDate(dt.getUTCDate()-1);return dt.toISOString().slice(0,10);}
const ev=(s:Sheet,c?:Cell):Evidence[]=>c?[{sheet:s.name,cell:c.ref,value:c.value??null,...(c.formula?{formula:c.formula}:{})}]:[];
function get(s:Sheet|undefined,ref:string){return s?.cells.find(c=>c.ref===ref);}
function findSheet(b:SourceBook,name:string){return b.sheets.find(s=>norm(s.name)===name);}
export function parseWorkbook(book:SourceBook):Reading {
 const {sheets,...source}=book;
 const result:Reading={schemaVersion:1,source,identity:'Sin identificar',address:'Sin identificar',currentStart:null,currentEnd:null,window:null,evidence:[],blocks:[],issues:[]};
 if(/conflicto|conflicted copy/i.test(book.name))result.issues.push('Archivo identificado como copia en conflicto de Dropbox. Resolver la versión antes de confirmar estados.');
 const info=findSheet(book,'INFO CONTRATO');
 if(info){
  result.identity=String(get(info,'A1')?.value??result.identity);result.address=String(get(info,'C2')?.value??result.address);
  // Localizamos el conjunto de etiquetas en lugar de fijar una fila de la plantilla.
  const starts=info.cells.filter(c=>norm(c.value)==='FECHA DE INICIO');
  const layouts=starts.map(c=>({col:column(c.ref),first:row(c.ref)})).filter(({col,first})=>
   norm(get(info,col+(first+2))?.value)==='FECHA DE FIN' && norm(get(info,col+(first+4))?.value)==='FECHA DE PAGO');
  const metadataRefs=['A1','C2'];
  if(layouts.length===1){
   const {col,first}=layouts[0];
   const valueCol=colName(colNumber(col)+2);
   const refs=[first,first+2,first+4].map(n=>valueCol+n);
   metadataRefs.push(...refs);
   result.currentStart=parseDate(get(info,refs[0])?.value);
   result.currentEnd=parseDate(get(info,refs[1])?.value);
   const w=norm(get(info,refs[2])?.value).match(/^(\d{1,2})\s*(?:AL|A|-)\s*(\d{1,2})$/);
   if(w&&+w[1]>=1&&+w[1]<=31&&+w[2]>=1&&+w[2]<=31) result.window=[+w[1],+w[2]];
  }else result.issues.push('La estructura de INFO CONTRATO no permite identificar un único conjunto de fechas.');
  for(const ref of metadataRefs)result.evidence.push(...ev(info,get(info,ref)));
  if(result.evidence.some(e=>e.formula))result.issues.push('La identidad o las fechas contractuales contienen fórmulas sin recalcular.');
 }else result.issues.push('No se encontró INFO CONTRATO. Identidad pendiente.');
 if(!result.currentStart||!result.currentEnd||result.currentStart>result.currentEnd)result.issues.push('Las fechas del contrato actual no son válidas.');
 if(!result.window)result.issues.push('No se identificó una ventana de pago válida.');
 for(const sheet of sheets.filter(s=>norm(s.name)==='PAGOS')){
  const cellMap=new Map(sheet.cells.map(c=>[c.ref,c]));const at=(ref:string)=>cellMap.get(ref);
  const headers=sheet.cells.filter(c=>/^CONTRATO\b/.test(norm(c.value))).sort((a,b)=>row(a.ref)-row(b.ref));
  for(let h=0;h<headers.length;h++){
   const header=headers[h],dates=String(header.value).match(/\d{1,2}[-/]\d{1,2}[-/]\d{4}/g);
   const start=dates?.[0]?parseDate(dates[0]):null,end=dates?.[1]?parseDate(dates[1]):null;
   if(!start||!end||start>end){result.issues.push(`${sheet.name}!${header.ref}: no se puede identificar la duración del bloque.`);continue;}
   const headerRow=row(header.ref),stop=headers[h+1]?row(headers[h+1].ref):Math.max(...sheet.cells.map(c=>row(c.ref)))+1;
   let labels:Cell[]=[];
   for(let r=headerRow+1;r<=headerRow+3;r++){const cs=sheet.cells.filter(c=>row(c.ref)===r);if(cs.some(c=>norm(c.value)==='MES')&&cs.some(c=>norm(c.value)==='ALQ')){labels=cs;break;}}
   if(!labels.length){result.issues.push(`${sheet.name}!${header.ref}: encabezados de movimientos no reconocidos.`);continue;}
   const key=(label:string)=>labels.find(c=>norm(c.value)===label);
   const monthCol=column(key('MES')!.ref),amountCol=column(key('ALQ')!.ref),dateCol=key('FECHA DE PAGO')?column(key('FECHA DE PAGO')!.ref):null,receiptCol=key('RECIBO')?column(key('RECIBO')!.ref):null;
   if(!dateCol||!receiptCol){result.issues.push(`${sheet.name}!${header.ref}: faltan columnas de fecha o recibo.`);continue;}
   const sequenceCol=colName(colNumber(dateCol)-1);
   const block:ContractBlock={id:`${book.sourceId??book.fingerprint}:${sheet.name}:${header.ref}:${start}:${end}`,start,end,sheet:sheet.name,header:header.ref,periods:[],issues:[]};
   const cap=Number(end.slice(0,4))*12+Number(end.slice(5,7))-(Number(start.slice(0,4))*12+Number(start.slice(5,7)))+1;
   if(cap>120){result.issues.push(`${sheet.name}!${header.ref}: duración fuera del límite de la prueba (10 años).`);continue;}
   let current:Period|null=null;
   for(let r=row(labels[0].ref)+1;r<stop;r++){
    const mc=at(`${monthCol}${r}`),ac=at(`${amountCol}${r}`),dc=at(`${dateCol}${r}`),rc=at(`${receiptCol}${r}`),nc=at(`${sequenceCol}${r}`);
    // Las tablas de servicios al pie tienen un año seguido de meses en columnas.
    const serviceMonths=[mc,rc,ac].map(c=>MONTHS[norm(c?.value)]);
    if(!nc?.value && /^(19|20)\d{2}$/.test(String(dc?.value)) &&
       serviceMonths.every(Boolean) && serviceMonths[1]===serviceMonths[0]%12+1 &&
       serviceMonths[2]===serviceMonths[1]%12+1){current=null;continue;}
    const label=norm(mc?.value);if(!label)continue;const month=MONTHS[label],cross=/^[A-Z]-[A-Z]$/.test(label);if(!month&&!cross)continue;
    const n=typeof nc?.value==='number'?nc.value:null;
    if(n!==null){
     if(!Number.isInteger(n)||n<1||n>120){block.issues.push(`Fila ${r}: número de período inválido.`);current=null;continue;}
     const periodStart=addMonths(start,n-1),periodEnd=previousDay(addMonths(start,n));
     current={key:periodStart.slice(0,7),label,sequence:n,start:periodStart,end:periodEnd,movements:[],issues:[],evidence:[...ev(sheet,header),...ev(sheet,nc),...ev(sheet,mc)],amountMentioned:null,amountEvidence:[]};
     if(block.periods.some(p=>p.sequence===n))current.issues.push('Número de período repetido dentro del mismo contrato.');
     if(periodStart>end)current.issues.push('Período posterior a la finalización del contrato: posible renovación.');
     if(month&&month!==+periodStart.slice(5,7))current.issues.push('El mes escrito no coincide con el número de período y el inicio del contrato.');
     if(cross){const names=['E','F','M','A','M','J','J','A','S','O','N','D'];const m=+periodStart.slice(5,7)-1;if(label!==`${names[m]}-${names[(m+1)%12]}`)current.issues.push('La abreviatura del período que cruza meses es inconsistente.');}
     block.periods.push(current);
    }else if(!current||current.label!==label){block.issues.push(`Fila ${r}: mes sin número de período ni bloque inequívoco.`);continue;}
    if(!current)continue;
    const amount=parseMoney(ac?.value),date=parseDate(dc?.value),receipt=String(rc?.value??'').trim();
    if((ac?.value!==undefined&&ac.value!=='')||(dc?.value!==undefined&&dc.value!=='')||receipt){
     const issues:string[]=[];
     if(amount===null||amount<=0)issues.push('Importe de alquiler ausente, inválido o no positivo.');
     if(!date)issues.push('Importe sin fecha de pago válida: puede ser un monto previsto, no un cobro.');
     if(date&&date<start)issues.push('La fecha del pago es anterior al contrato. Requiere comprobar anticipo o error de año.');
     if(ac?.formula||dc?.formula||rc?.formula)issues.push('Movimiento basado en fórmula sin recalcular.');
     current.movements.push({id:`${block.id}:${current.key}:${receipt||'sin-recibo'}:${date??'sin-fecha'}:${amount??'sin-importe'}`,row:r,amount,date,receipt,evidence:[...ev(sheet,mc),...ev(sheet,ac),...ev(sheet,dc),...ev(sheet,rc)],issues,recorded:issues.length===0});
    }
    for(const c of sheet.cells.filter(c=>row(c.ref)===r&&colNumber(column(c.ref))>colNumber(amountCol)+8)){
     const match=String(c.value??'').trim().match(/^CANON\s+([\d.,]+)$/i);if(match){current.amountMentioned=parseMoney(match[1]);current.amountEvidence.push(...ev(sheet,c));}
    }
   }
   const seen=new Map<string,Movement>();const receipts=new Map<string,{p:Period;m:Movement}>();
   for(const p of block.periods)for(const m of p.movements){
    if(seen.has(m.id)){m.recorded=false;m.issues.push('Movimiento repetido: se excluye de la suma y requiere revisión.');}else seen.set(m.id,m);
    if(m.receipt){const old=receipts.get(m.receipt);if(old){if(old.p.key!==p.key||old.m.amount!==m.amount||old.m.date!==m.date){m.recorded=false;old.m.recorded=false;m.issues.push('Recibo reutilizado en otro período o con datos incompatibles.');old.m.issues.push('Recibo reutilizado en otro período o con datos incompatibles.');}}else receipts.set(m.receipt,{p,m});}
   }
   result.blocks.push(block);
  }
 }
 if(!result.blocks.length)result.issues.push('No se reconocieron bloques de contrato en la hoja PAGOS.');
 if(result.currentStart&&!result.blocks.some(b=>b.start===result.currentStart&&b.end===result.currentEnd))result.issues.push('INFO CONTRATO no coincide con un bloque de PAGOS.');
 return result;
}
export function dueDate(period:Period,window:[number,number]):string|null {
 const iso=window[1]<window[0]?addMonths(period.start,1):period.start;const [y,m]=iso.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).getUTCDate();
 if(window[0]>31||window[1]>31||window[0]<1||window[1]<1)return null;return `${y}-${pad(m)}-${pad(Math.min(window[1],last))}`;
}
export function evaluate(reading:Reading,block:ContractBlock,p:Period,today=argentinaToday(),validation?:Validation):Evaluation {
 const issues=[...reading.issues,...block.issues,...p.issues,...p.movements.flatMap(m=>m.issues)];const dedup=new Set<string>();let cents=0;
 for(const m of p.movements)if(m.recorded&&m.amount!==null&&!dedup.has(m.id)){dedup.add(m.id);if(m.date&&m.date>today)issues.push('El registro de pago tiene fecha futura para la fecha de control.');else cents+=Math.round(m.amount*100);}
 const recorded=cents/100;const validated=!!validation?.identityConfirmed&&!!validation.windowConfirmed&&!!validation.reference.trim()&&validation.expected>0&&Number.isFinite(validation.expected);
 const expected=validated?validation!.expected:null;
 if(!validated)issues.push('Falta validar identidad, ventana e importe exigible contra el contrato y sus actualizaciones.');
 if(validated&&p.movements.some(m=>m.recorded&&!m.receipt)&&!validation?.paymentConfirmed)issues.push('Cobro registrado sin recibo o referencia: requiere confirmación con evidencia adicional.');
 const deadline=reading.window?dueDate(p,reading.window):null;const balance=expected!==null?Math.max(0,Math.round(expected*100)-cents)/100:null;
 let status:Evaluation['status']='REVISAR';
 if(issues.length===0&&expected!==null&&deadline){if(cents>Math.round(expected*100))issues.push('El cobro supera el importe exigible: comprobar imputación o varios contratos.');else if(cents===Math.round(expected*100))status='PAGADO';else if(cents>0)status='PAGO PARCIAL';else if(today>deadline)status='SIN COBRO REGISTRADO — PLAZO VENCIDO';else if(today<p.start)status='PRÓXIMO';else status='EN PLAZO';}
 return {status,recorded,expected,balance:issues.length?null:balance,issues:[...new Set(issues)],dueDate:deadline};
}
