import {copyFile,readFile,writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url), shared=new URL('supabase/functions/_shared/',root);
await mkdir(shared,{recursive:true});
for(const file of ['reader.ts','conflict.mjs','estado-cobro.mjs','vendor/xlsx.mjs','vendor/xlsx.d.mts','vendor/SHEETJS-LICENSE']){
 await copyFile(new URL('lib/'+file,root),new URL(file.split('/').pop(),shared));
}
const loader=await readFile(new URL('lib/load-workbook.ts',root),'utf8');
await writeFile(new URL('load-workbook.ts',shared),loader.replace("import * as XLSX from 'xlsx'","// @deno-types='./xlsx.d.mts'\nimport * as XLSX from './xlsx.mjs'"));
