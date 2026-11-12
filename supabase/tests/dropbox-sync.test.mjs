import assert from 'node:assert/strict';
import test from 'node:test';
import * as X from '../../lib/vendor/xlsx.mjs';
import {synchronize} from '../functions/_shared/sincronizar.mjs';
function sample(amount) {
 const wb=X.utils.book_new();
 const info=X.utils.aoa_to_sheet([['Propietario - Inquilino'],['','','Unidad de prueba'],['','','','','FECHA DE INICIO','','01/11/2026'],[],['','','','','FECHA DE FIN','','31/10/2027'],[],['','','','','FECHA DE PAGO','','1 al 10']]);
 const payments=X.utils.aoa_to_sheet([['','','','CONTRATO 01-11-2026 AL 31-10-2027'],['','FECHA DE PAGO','MES','RECIBO','ALQ'],[1,amount?'03/11/2026':null,'NOV',amount?'99':null,amount||null]]);
 X.utils.book_append_sheet(wb,info,'INFO CONTRATO');X.utils.book_append_sheet(wb,payments,'PAGOS');
 return X.write(wb,{type:'array',bookType:'xlsx'});
}
test('Dropbox: ingreso, pago nuevo, lectura interrumpida, borrado y cursor durable',async()=>{
 const bytes=[sample(0),sample(327000)];
 const meta=rev=>({'.tag':'file',path_lower:'/ficha.xlsx',name:'Ficha.xlsx',rev:String(rev),size:bytes[rev].byteLength,server_modified:'2026-11-12T12:00:00Z'});
 let seq=0, broken=false, files=new Map(), commits=0;
 let state={cursor:null,source_key:null,full_scan:true,full_scan_date:null};
 const pages=[{entries:[meta(0)],cursor:'a',has_more:false},{entries:[meta(1)],cursor:'b',has_more:false},{entries:[{'.tag':'deleted',path_lower:'/ficha.xlsx'}],cursor:'c',has_more:false}];
 const deps={sourceKey:'folder',today:'2026-11-12',claim:async()=>'lease',readState:async()=>state,validations:async()=>({}),
  client:{list:async c=>{assert.equal(c,[null,'a','b'][seq]);return pages[seq]},download:async f=>{if(broken)throw Error('desconectado');return bytes[+f.rev]}},
  commit:async args=>{if(args.p_error)return;commits++;state={cursor:args.p_cursor,source_key:'folder',full_scan:false,full_scan_date:'2026-11-12'};for(const f of args.p_files)files.set(f.path,f);for(const k of args.p_deleted)files.delete(k);}
 };
 await synchronize(deps);assert.equal(files.get('/ficha.xlsx').reading[0].importe_registrado,0);seq++;
 broken=true;await assert.rejects(()=>synchronize(deps));assert.equal(commits,1);assert.equal(state.cursor,'a');
 broken=false;await synchronize(deps);const row=files.get('/ficha.xlsx').reading[0];
 assert.equal(row.estado,'COBRO REGISTRADO');assert.equal(row.importe_registrado,327000);
 assert.deepEqual(row.fechas_pago,['2026-11-03']);assert.deepEqual(row.recibos,['99']);
 assert.equal(row.ventana_pago,'Del 1 al 10');assert.equal(row.vencimiento,'2026-11-10');
 seq++;await synchronize(deps);assert.equal(files.size,0);assert.equal(state.cursor,'c');
});
test('un listado mayor que el lote persiste el resto y no anuncia actualización completa',async()=>{
 let state={full_scan:true},lists=0;const del=n=>({'.tag':'deleted',path_lower:'/n'+n});const completed=[];
 const deps={sourceKey:'uno',today:'2026-11-12',limit:1,claim:async()=>1,readState:async()=>state,validations:async()=>({}),
  client:{list:async()=>{lists++;return {entries:[del(1),del(2)],cursor:'c',has_more:false}}},
  commit:async a=>{state={source_key:'uno',cursor:a.p_cursor,full_scan:true,pending:a.p_pending};completed.push(a.p_complete);}
 };
 await synchronize(deps);await synchronize(deps);
 assert.equal(lists,1);assert.deepEqual(completed,[false,true]);
});
