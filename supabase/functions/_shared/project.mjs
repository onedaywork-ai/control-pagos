import {evaluate} from './reader.ts';
import {estadoCobro} from './estado-cobro.mjs';

export function project(reading, validations, today) {
 const r={...reading,issues:reading.issues.filter(i=>!i.startsWith('Archivo identificado como copia en conflicto'))};
 const blocks=r.blocks.filter(b=>b.start===r.currentStart && b.end===r.currentEnd);
 const base={titular:r.identity,inmueble:r.address,fechas_pago:[],recibos:[],vencimiento:null,
   ventana_pago:r.window ? 'Del '+r.window[0]+' al '+r.window[1]+(r.window[1]<r.window[0]?' del mes siguiente':'') : null};
 if(blocks.length!==1 || !blocks[0].periods.length) return [{...base,periodo:'*',estado:'REVISAR',
   importe_registrado:null,evidencia:[r.source.name,...r.issues,'Sin períodos inequívocos del contrato actual.']}];
 const [block]=blocks;
 return block.periods.map(p=>{
   const v=validations[block.id+'|'+p.key];
   const valid=v?.identityConfirmed===true && v.windowConfirmed===true && typeof v.reference==='string' && Number.isFinite(v.expected);
   const result=evaluate(r,block,p,today,valid?v:undefined);
   const status=estadoCobro(result,p,v);
   const records=p.movements.filter(m=>m.recorded && m.date<=today);
   // Keep evidence of each partial payment, including payments without a receipt.
   const evidence=p.movements.map(m=>[m.date??'Sin fecha',m.amount==null?'Sin importe':'$ '+m.amount,
     m.receipt?'Recibo '+m.receipt:'Sin recibo',m.evidence.map(e=>e.sheet+'!'+e.cell).join(', ')].join(' · '));
   return {...base,periodo:p.key,estado:status,importe_registrado:result.recorded,
     fechas_pago:records.map(m=>m.date),recibos:records.map(m=>m.receipt || 'Sin recibo'),vencimiento:result.dueDate,
     evidencia:[r.source.name,...evidence,...(status==='PAGADO' && result.status!=='PAGADO'?[v.liquidacion.referencia]:result.issues)]};
 });
}
