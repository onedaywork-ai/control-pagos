import {readFile,writeFile} from 'node:fs/promises';
const [source,destination]=process.argv.slice(2);
if(!source||!destination) throw new Error('Indicá validaciones.json y una ruta SQL privada de salida.');
const validation=JSON.parse(await readFile(source,'utf8'));
const rows=Object.entries(validation).map(([id,value])=>({id,value}));
const hex=Buffer.from(JSON.stringify(rows)).toString('hex');
await writeFile(destination,`insert into public.sc_validations(id,value)
select id,value from jsonb_to_recordset(convert_from(decode('${hex}','hex'),'UTF8')::jsonb) as v(id text,value jsonb)
on conflict(id) do update set value=excluded.value;
`,{mode:0o600,flag:'wx'});
