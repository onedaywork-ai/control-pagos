import test from 'node:test';
import assert from 'node:assert/strict';
import {estadoCobro} from '../lib/estado-cobro.mjs';
test('distingue cobro registrado, liquidación confirmada y evidencia incompatible',()=>{
 const r={status:'REVISAR',expected:null,recorded:100,issues:['Falta validar identidad, ventana e importe exigible contra el contrato y sus actualizaciones.']};
 const p={movements:[{recorded:true,receipt:'1',date:'2026-11-03',amount:100}]};
 const v={liquidacion:{referencia:'Confirmación del operador',recibo:'1',fecha:'2026-11-03',importe:100}};
 assert.equal(estadoCobro(r,p), 'COBRO REGISTRADO');
 assert.equal(estadoCobro(r,p,v), 'PAGADO');
 assert.equal(estadoCobro(r,p,{liquidacion:{...v.liquidacion,recibo:'2'}}),'COBRO REGISTRADO');
 assert.equal(estadoCobro({...r,issues:['Recibo duplicado']},p,v),'REVISAR');
});
