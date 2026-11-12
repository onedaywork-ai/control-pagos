import {loadWorkbook} from './load-workbook.ts';
import {argentinaToday} from './reader.ts';
import {snapshot,family,isConflict} from './conflict.mjs';
import {project} from './project.mjs';

// A durable cursor advances together with its staged rows. The previous complete
// snapshot remains visible until every page and file in the change set is ready.
export async function synchronize({claim,readState,commit,client,cached,validations,sourceKey,today=argentinaToday(),limit=6}) {
 const lease=await claim();
 if(!lease) return 'ocupado';
 try {
   const state=await readState();
   let restart=state.source_key!==sourceKey || (!state.full_scan && state.full_scan_date!==today);
   let full=restart || state.full_scan;
   let page=restart?null:state.pending;
   if(!page) {
     try {page=await client.list(restart?null:state.cursor);}
     catch(e){if(!e.reset)throw e;full=true;restart=true;page=await client.list(null);}
   }
   if(!Array.isArray(page.entries)||typeof page.cursor!=='string'||typeof page.has_more!=='boolean') throw new Error('Listado incompleto de Dropbox.');
   const entries=page.entries.slice(0,limit), remaining=page.entries.slice(limit);
   const settings=entries.length?await validations():{};
   const changes=new Map();
   for(const meta of entries){
     const key=meta.path_lower;
     if(typeof key!=='string' || !key.startsWith('/')) throw new Error('Ruta de ficha no reconocida.');
     if(meta['.tag']==='deleted'||meta['.tag']==='folder'){changes.set(key,null);continue;}
     if(meta['.tag']!=='file') throw new Error('Tipo de archivo no reconocido.');
     if(!/\.xls[xm]?$/i.test(meta.name)||meta.name.startsWith('~$')){changes.set(key,null);continue;}
     const record={path:key,name:meta.name,rev:meta.rev,modified:meta.server_modified,family:family(meta.name),conflict:isConflict(meta.name),reading:[],snapshot:{},error:null};
     if(meta.size>15*1024*1024){record.error='Ficha de más de 15 MB: requiere revisión.';}
     else {
       const existing=cached ? await cached(key,meta.rev) : null;
       if(existing?.parsed) {
         record.snapshot=existing.snapshot; record.parsed=existing.parsed;
         record.reading=project(existing.parsed,settings,today);
       } else {
         const bytes=await client.download(meta);
         try{
           let cells;
           record.parsed=await loadWorkbook(meta.name,bytes,{},sheets=>{cells=snapshot(sheets);});
           // Compare cell fingerprints; unrelated personal fields in the workbook never become panel data.
           if(cells.size>100000) throw new Error('Demasiadas celdas.');
           const encoder=new TextEncoder();
           const values=[...cells];
           const hashes={};
           for(let i=0;i<values.length;i+=96){
             await Promise.all(values.slice(i,i+96).map(async ([k,value])=>{
               const hash=await crypto.subtle.digest('SHA-256',encoder.encode(value));
               hashes[k]=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
             }));
           }
           record.snapshot=hashes;record.reading=project(record.parsed,settings,today);
         } catch {record.error='No se pudo interpretar la ficha. Revisar su formato.';record.snapshot={};record.parsed=null;}
       }
     }
     changes.set(key,record);
   }
   const complete=!page.has_more && !remaining.length;
   const pending=remaining.length?{...page,entries:remaining}:null;
   await commit({p_lease:lease,p_files:[...changes.values()].filter(Boolean),p_deleted:[...changes].filter(([,v])=>!v).map(([k])=>k),
     p_cursor:page.cursor,p_complete:complete,p_full_scan:full,p_restart:restart,p_pending:pending,p_source_key:sourceKey,p_error:null});
   return complete?'ok':'importando';
 } catch(e) {
   await commit({p_lease:lease,p_files:[],p_deleted:[],p_cursor:null,p_complete:false,p_full_scan:false,p_restart:false,
     p_pending:null,p_source_key:sourceKey,p_error:e.safeMessage || 'No se completó la lectura. Se conserva la última actualización completa.'});
   throw e;
 }
}
