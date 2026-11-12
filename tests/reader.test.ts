import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWorkbook,parseMoney,parseDate,argentinaToday,evaluate,dueDate,type SourceBook,type Validation} from '../lib/reader.ts';
const valid:Validation={expected:1000,identityConfirmed:true,windowConfirmed:true,reference:'Contrato de prueba, cláusula de canon'};
function book(rows:Record<string,string|number>,start='2026-09-01',end='2027-08-31',window='1 AL 10'):SourceBook {
 return {name:'prueba.xlsx',fingerprint:'abc',sheets:[{name:'INFO CONTRATO',cells:Object.entries({A1:'Propietario A - Inquilino A',C2:'Calle 1 Local 1',E3:'FECHA DE INICIO',E5:'FECHA DE FIN',E7:'FECHA DE PAGO',G3:start,G5:end,G7:window}).map(([ref,value])=>({ref,value}))},{name:'PAGOS ',cells:Object.entries({D1:`CONTRATO ${start.split('-').reverse().join('-')} AL ${end.split('-').reverse().join('-')}`,B2:'FECHA DE PAGO',C2:'MES',D2:'RECIBO',E2:'ALQ',...rows}).map(([ref,value])=>({ref,value}))}]};
}
function read(rows:Record<string,string|number>){return parseWorkbook(book(rows));}
test('parsea importes argentinos sin convertir vacíos en cero',()=>{assert.equal(parseMoney('1.234.567,89'),1234567.89);assert.equal(parseMoney('$ 1.200.000'),1200000);assert.equal(parseMoney(''),null);assert.equal(parseMoney('pendiente'),null);assert.equal(parseMoney('0'),0);assert.equal(parseMoney('12.34.56'),null);});
test('valida fechas reales y no adivina años de dos dígitos',()=>{assert.equal(parseDate('31/02/2026'),null);assert.equal(parseDate('13-10-2026'),'2026-10-13');assert.equal(parseDate('13/10/26'),null);});
test('fecha de Argentina en el cambio de día UTC',()=>assert.equal(argentinaToday(new Date('2026-11-10T01:00:00Z')),'2026-11-09'));
test('asigna el año por inicio y número, no por fecha de transferencia',()=>{const r=read({A3:4,C3:'DIC',B3:'2027-01-06',D3:'r1',E3:1000});assert.equal(r.blocks[0].periods[0].key,'2026-12');});
test('no usa un pago de un bloque histórico para el contrato actual',()=>{const b=book({A3:2,C3:'OCT',B3:'2026-10-13',E3:1000});b.sheets[1].cells.push(...Object.entries({D10:'CONTRATO 01-09-2022 AL 31-08-2023',B11:'FECHA DE PAGO',C11:'MES',D11:'RECIBO',E11:'ALQ',A12:2,C12:'OCT',B12:'2022-10-06',E12:20}).map(([ref,value])=>({ref,value})));const r=parseWorkbook(b);assert.equal(r.blocks[0].periods[0].key,'2026-10');assert.equal(r.blocks[1].periods[0].key,'2022-10');assert.equal(r.blocks[0].periods[0].movements[0].amount,1000);});
test('reconoce encabezados desplazados una columna',()=>{const b=book({});b.sheets[1].cells=Object.entries({E1:'CONTRATO 01-09-2026 AL 31-08-2027',C2:'FECHA DE PAGO',D2:'MES',E2:'RECIBO',F2:'ALQ',B3:2,C3:'2026-10-13',D3:'OCT',F3:1000}).map(([ref,value])=>({ref,value}));assert.equal(parseWorkbook(b).blocks[0].periods[0].movements[0].amount,1000);});
test('suma dos pagos del mismo período sin cambiarlo por la fecha',()=>{const r=read({A3:1,C3:'SET',B3:'2026-09-21',D3:'a',E3:700,C4:'SET',B4:'2026-09-30',D4:'b',E4:300});const b=r.blocks[0],p=b.periods[0];assert.equal(p.movements.length,2);assert.equal(evaluate(r,b,p,'2026-10-10',valid).status,'PAGADO');assert.equal(evaluate(r,b,p,'2026-10-10',valid).recorded,1000);});
test('no suma un importe sin fecha ni lo declara cobrado',()=>{const r=read({A3:1,C3:'SET',B3:'2026-09-25',D3:'a',E3:700,C4:'SET',E4:300});const e=evaluate(r,r.blocks[0],r.blocks[0].periods[0],'2026-10-10',valid);assert.equal(e.recorded,700);assert.equal(e.status,'REVISAR');});
test('falta de recibo no demuestra deuda y requiere corroboración',()=>{const r=read({A3:1,C3:'SET',B3:'2026-09-25',E3:1000});assert.equal(evaluate(r,r.blocks[0],r.blocks[0].periods[0],'2026-10-10',valid).status,'REVISAR');});
test('un monto exigible desconocido impide PAGADO',()=>{const r=read({A3:1,C3:'SET',B3:'2026-09-25',D3:'a',E3:1000});assert.equal(evaluate(r,r.blocks[0],r.blocks[0].periods[0],'2026-10-10').status,'REVISAR');});
test('marca pago parcial con monto exigible validado',()=>{const r=read({A3:1,C3:'SET',B3:'2026-09-25',D3:'a',E3:600});const e=evaluate(r,r.blocks[0],r.blocks[0].periods[0],'2026-10-10',valid);assert.equal(e.status,'PAGO PARCIAL');assert.equal(e.balance,400);});
test('no convierte ausencia de cobro en DEUDA CONFIRMADA',()=>{const r=read({A3:1,C3:'SET'});assert.equal(evaluate(r,r.blocks[0],r.blocks[0].periods[0],'2026-10-10',valid).status,'SIN COBRO REGISTRADO — PLAZO VENCIDO');});
test('el último día de la ventana sigue en plazo',()=>{const r=read({A3:1,C3:'SET'});assert.equal(evaluate(r,r.blocks[0],r.blocks[0].periods[0],'2026-09-10',valid).status,'EN PLAZO');});
test('una ventana 25 al 5 vence al mes siguiente',()=>{const r=parseWorkbook(book({A3:1,C3:'S-O'},'2026-09-25','2027-09-24','25 AL 05'));assert.equal(dueDate(r.blocks[0].periods[0],r.window!),'2026-10-05');assert.equal(evaluate(r,r.blocks[0],r.blocks[0].periods[0],'2026-10-05',valid).status,'EN PLAZO');});
test('marca meses futuros sin cobros como próximos',()=>{const r=read({A3:3,C3:'NOV'});assert.equal(evaluate(r,r.blocks[0],r.blocks[0].periods[0],'2026-10-10',valid).status,'PRÓXIMO');});
test('un mismo movimiento repetido se cuenta una vez',()=>{const r=read({A3:1,C3:'SET',B3:'2026-09-25',D3:'a',E3:1000,C4:'SET',B4:'2026-09-25',D4:'a',E4:1000});const e=evaluate(r,r.blocks[0],r.blocks[0].periods[0],'2026-10-10',valid);assert.equal(e.recorded,1000);assert.equal(e.status,'REVISAR');});
test('recibo copiado a otro período invalida ambos movimientos',()=>{const r=read({A3:1,C3:'SET',B3:'2026-09-25',D3:'a',E3:1000,A5:2,C5:'OCT',B5:'2026-10-05',D5:'a',E5:1000});for(const p of r.blocks[0].periods)assert.equal(evaluate(r,r.blocks[0],p,'2026-10-10',valid).status,'REVISAR');assert.equal(r.blocks[0].periods[1].movements[0].recorded,false);});
test('fecha del año anterior se señala y no se computa',()=>{const r=read({A3:1,C3:'SET',B3:'2025-09-25',E3:1000});assert.equal(r.blocks[0].periods[0].movements[0].recorded,false);});
test('no se acepta una fecha futura de pago',()=>{const r=read({A3:1,C3:'SET',B3:'2026-12-25',D3:'a',E3:1000});assert.equal(evaluate(r,r.blocks[0],r.blocks[0].periods[0],'2026-10-10',valid).recorded,0);});
test('copia en conflicto bloquea el pago confirmado',()=>{const b=book({A3:1,C3:'SET',B3:'2026-09-25',D3:'a',E3:1000});b.name='Copia en conflicto.xlsx';const r=parseWorkbook(b);assert.equal(evaluate(r,r.blocks[0],r.blocks[0].periods[0],'2026-10-10',valid).status,'REVISAR');});
test('no fusiona unidades con nombres semejantes',()=>{const a=book({A3:1,C3:'SET'}),b=structuredClone(a);a.sourceId='id:uno';b.sourceId='id:dos';b.sheets[0].cells.find(c=>c.ref==='C2')!.value='Calle 1 Local 2';const r1=parseWorkbook(a),r2=parseWorkbook(b);assert.notEqual(r1.blocks[0].id,r2.blocks[0].id);assert.notEqual(r1.address,r2.address);});
test('cambiar estructura pone el archivo en revisión',()=>{const b=book({A3:1,C3:'SET'});b.sheets[0].cells.find(c=>c.ref==='E3')!.value='Otra columna';assert.ok(parseWorkbook(b).issues.some(s=>s.includes('estructura')));});
test('nunca toma el total de servicios como alquiler',()=>{const r=read({A3:1,C3:'SET',B3:'2026-09-25',D3:'a',E3:1000,N3:5000});assert.equal(r.blocks[0].periods[0].movements[0].amount,1000);});
test('fórmulas con valores guardados no prueban cobro',()=>{const b=book({A3:1,C3:'SET',B3:'2026-09-25',D3:'a',E3:1000});b.sheets[1].cells.find(c=>c.ref==='E3')!.formula='SUM(E20:E21)';assert.equal(parseWorkbook(b).blocks[0].periods[0].movements[0].recorded,false);});
test('metadatos desplazados y cuota 13 NOV distinguen el segundo noviembre',()=>{
 const b=book({A3:1,C3:'NOV',A27:13,C27:'NOV',B27:'2026-11-03',D27:659,E27:327000,C28:'NOV'},'2025-11-14','2027-11-13','14 AL 24');
 for(const c of b.sheets[0].cells) if(/^[EG]/.test(c.ref)) c.ref=c.ref[0]+(Number(c.ref.slice(1))+1);
 const r=parseWorkbook(b),block=r.blocks[0];
 assert.equal(block.start,r.currentStart); assert.equal(block.end,r.currentEnd); assert.deepEqual(r.window,[14,24]);
 assert.deepEqual(block.periods.map(p=>p.key),['2025-11','2026-11']);
 const second=block.periods[1];
 assert.equal(second.movements.length,1);
 assert.equal(second.movements[0].receipt,'659');
 assert.equal(evaluate(r,block,second,'2026-11-12').recorded,327000);
});
test('la grilla horizontal de servicios debajo de PAGOS no invalida los alquileres',()=>{
 const r=read({A3:1,B3:'2026-09-03',C3:'SEP',D3:1,E3:1000,B58:2026,C58:'ENERO',D58:'FEBRERO',E58:'MARZO',B59:'AGUA',C59:42,D59:42,E59:42});
 const b=r.blocks[0];
 assert.deepEqual(b.issues,[]);
 assert.equal(b.periods.length,1);
 assert.equal(evaluate(r,b,b.periods[0],'2026-11-12',valid).status,'PAGADO');
});
