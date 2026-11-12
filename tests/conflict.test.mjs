import test from 'node:test';
import assert from 'node:assert/strict';
import {family,resolveFamily} from '../lib/conflict.mjs';
const normal='Ficha.xlsx', copy='Ficha (Copia en conflicto de Ana 2026-10-01).xlsx';
const make=(name,entries)=>({name,cells:new Map(entries.map(([k,v])=>[JSON.stringify(['PAGOS',k]),v]))});
const a=make(normal,[['E1',100]]),b=make(copy,[['E1',100],['B1','2026-10-01']]);
test('agrupa copias sin juntar otros locales',()=>{assert.equal(family(copy),family(normal));assert.notEqual(family('Ficha LOCAL 2.xlsx'),family(normal));});
test('elige contenido adicional independientemente del nombre',()=>{assert.equal(resolveFamily([a,b]).winner,b);assert.equal(resolveFamily([{...a,name:copy},{...b,name:normal}]).winner.name,normal);});
test('celdas equivalentes se cuentan una sola vez',()=>assert.equal(resolveFamily([a,{...a,name:copy}]).winner,a));
test('un cambio incompatible o un archivo ilegible requieren revisión',()=>{for(const pair of [[a,make(copy,[['E1',200]])],[{name:copy,error:"ilegible"}],[a,{name:copy,error:'ilegible'}]])assert.equal(resolveFamily(pair).winner,undefined);});
test('no restaura celdas eliminadas en una versión más reciente',()=>assert.equal(resolveFamily([{...a,modified:new Date(2000)},{...b,modified:new Date(1000)}]).winner,undefined));

test('la única ficha legible es vigente aunque se llame copia en conflicto',()=>{
  assert.equal(resolveFamily([b]).winner,b);
});
test('varias copias sin nombre normal se comparan antes de elegir',()=>{
  const other={...a,name:'Ficha (Copia en conflicto de Beto 2026-11-01).xlsx'};
  assert.equal(resolveFamily([other,b]).winner,b);
  assert.equal(resolveFamily([make(other.name,[['E1',200]]),b]).winner,undefined);
});
