// @deno-types='./xlsx.d.mts'
import * as XLSX from './xlsx.mjs';
import { parseWorkbook, type SourceBook, type Cell } from './reader.ts';
export async function loadWorkbook(name:string,data:ArrayBuffer,metadata:Partial<SourceBook>={}, inspect?:(sheets:SourceBook["sheets"])=>void) {
 if(data.byteLength>15*1024*1024)throw new Error('La prueba admite archivos de hasta 15 MB.');
 if(!/\.(xlsx|xls|xlsm)$/i.test(name))throw new Error('Seleccioná una ficha .xlsx, .xls o .xlsm.');
 const bytes=new Uint8Array(data);const digest=await crypto.subtle.digest('SHA-256',bytes);
 const fingerprint=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
 const wb=XLSX.read(bytes,{type:'array',cellDates:true,cellFormula:true,sheetRows:10001});
 if(wb.SheetNames.length>40)throw new Error('El archivo supera las 40 hojas admitidas en esta prueba.');
 const sheets=wb.SheetNames.map(name=>{
  const s=wb.Sheets[name];if(s['!fullref']&&s['!fullref']!==s['!ref'])throw new Error('Hay más de 10.000 filas. Se detuvo la lectura para no omitir movimientos.');
  const cells:Cell[]=Object.entries(s).filter(([k])=>!k.startsWith('!')).map(([ref,c])=>({ref,value:c.v instanceof Date?c.v.toISOString().slice(0,10):c.v,type:c.t,formula:c.f}));
  if(cells.length>100000)throw new Error('La hoja supera el límite de celdas de esta prueba.');return {name,cells};
 });
 inspect?.(sheets);
 return parseWorkbook({...metadata,name,fingerprint,sheets});
}
