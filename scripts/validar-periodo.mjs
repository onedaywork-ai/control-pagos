import { createInterface } from 'node:readline/promises';
import { readFile,writeFile,rename } from 'node:fs/promises';
import { parseMoney } from '../lib/reader.ts';
const rl=createInterface({input:process.stdin,output:process.stdout});
try {
 const id=(await rl.question('Pegá el ID que figura en Ver evidencia: ')).trim();
 if(!/^[a-f0-9]{64}:.+\|\d{4}-\d{2}$/.test(id)) throw new Error('ID de período inválido.');
 const expected=parseMoney(await rl.question('Importe exigible confirmado para ese período: '));
 if(!(expected>0)) throw new Error('El importe debe ser positivo.');
 const reference=(await rl.question('Documento, cláusula o comprobante que respalda la revisión: ')).trim();
 if(!reference) throw new Error('Falta la referencia.');
 const yes=async q=>['s','sí','si'].includes((await rl.question(q+' [s/N] ')).trim().toLowerCase());
 if(!await yes('¿Contrastaste titular, inmueble, vigencia, ventana de pago e importe con el contrato?')) throw new Error('Validación cancelada.');
 const paymentConfirmed=await yes('¿Verificaste también los cobros sin recibo con un comprobante adicional identificado en la referencia?');
 let data={};
 try{data=JSON.parse(await readFile('validaciones.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 data[id]={expected,reference,identityConfirmed:true,windowConfirmed:true,paymentConfirmed,validatedAt:new Date().toISOString()};
 await writeFile('validaciones.json.tmp',JSON.stringify(data,null,2),{mode:0o600});await rename('validaciones.json.tmp','validaciones.json');
 console.log('Validación guardada para esta versión y período. Se verá en la próxima lectura.');
} finally {rl.close();}
