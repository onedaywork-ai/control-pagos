import {synchronize} from '../_shared/sincronizar.mjs';
const env=(key:string)=>Deno.env.get(key) || '';
function safe(message:string){return Object.assign(new Error(message),{safeMessage:message});}
function required(key:string){const v=env(key);if(!v)throw safe('Falta configurar '+key+'.');return v;}
const headers=(token:string)=>({Authorization:'Bearer '+token,'Content-Type':'application/json'});
async function db(endpoint:string,body?:unknown){
 const key=required('SUPABASE_SERVICE_ROLE_KEY');
 const res=await fetch(required('SUPABASE_URL')+'/rest/v1/'+endpoint,{method:body===undefined?'GET':'POST',
 headers:{...headers(key),apikey:key},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
 if(!res.ok) throw safe('No se pudo guardar o consultar la sincronización en Supabase.');
 const t=await res.text();return t?JSON.parse(t):null;
}
function dropbox(folder:string,namespace:string){
 let token='';
 async function request(url:string, extra:Record<string,string>, body?:string){
  if(!token){
    const data=new URLSearchParams({grant_type:'refresh_token',refresh_token:required('DROPBOX_REFRESH_TOKEN'),client_id:required('DROPBOX_APP_KEY')});
    if(env('DROPBOX_APP_SECRET'))data.set('client_secret',env('DROPBOX_APP_SECRET'));
    const auth=await fetch('https://api.dropboxapi.com/oauth2/token',{method:'POST',body:data,signal:AbortSignal.timeout(12000)});
    if(!auth.ok)throw safe('Dropbox no renovó la autorización. Revisá la conexión de solo lectura.');
    token=(await auth.json()).access_token;
  }
  const h:Record<string,string>={Authorization:'Bearer '+token,...extra};
  if(namespace)h['Dropbox-API-Path-Root']=JSON.stringify({'.tag':'namespace_id',namespace_id:namespace});
  const res=await fetch(url,{method:'POST',headers:h,body,signal:AbortSignal.timeout(15000)});
  if(!res.ok){
    const err=await res.json().catch(()=>({}));
    const e=safe('Dropbox no pudo completar la consulta (HTTP '+res.status+').');
    throw Object.assign(e,{reset:res.status===409&&err.error?.['.tag']==='reset'});
  }
  return res;
 }
 return {
  async list(cursor:string|null){
    if(!folder.startsWith('/'))throw safe('Configurá la ruta Dropbox de CARGADAS.');
    const endpoint=cursor?'list_folder/continue':'list_folder';
    const args=cursor?{cursor}:{path:folder,recursive:false,include_deleted:true,limit:6};
    return (await request('https://api.dropboxapi.com/2/files/'+endpoint,{'Content-Type':'application/json'},JSON.stringify(args))).json();
  },
  async download(file:{id:string,rev:string,size:number}){
    const res=await request('https://content.dropboxapi.com/2/files/download',{'Dropbox-API-Arg':JSON.stringify({path:'rev:'+file.rev})});
    const meta=JSON.parse(res.headers.get('Dropbox-API-Result')||'null');
    if(meta?.id!==file.id||meta?.rev!==file.rev||meta?.size!==file.size) throw safe('La revisión descargada no coincide con el listado.');
    const bytes=await res.arrayBuffer();if(bytes.byteLength!==file.size)throw safe('La descarga de Dropbox quedó incompleta.');
    return bytes;
  }
 };
}
Deno.serve(async req=>{
 const secret=env('SC_SYNC_SECRET');
 if(req.method!=='POST'||secret.length<32||req.headers.get('Authorization')!=='Bearer '+secret)return new Response(null,{status:403});
 try {
   const folder=env('DROPBOX_FOLDER'),namespace=env('DROPBOX_NAMESPACE_ID');
   const api=dropbox(folder,namespace);
   const until=Date.now()+20000;
   let status;
   do {status=await synchronize({claim:()=>db('rpc/sc_claim_sync',{}),readState:async()=>(await db('sc_sync?select=*&id=eq.1'))[0],
    commit:(params:unknown)=>db('rpc/sc_commit_sync',params),client:api,
    cached:(path:string,rev:string)=>db('rpc/sc_cached',{p_path:path,p_rev:rev}),
    validations:async()=>{
      const all:Record<string,unknown>={};let offset=0;
      while(true){const batch=await db('sc_validations?select=id,value&order=id&limit=250&offset='+offset);
        if(!batch.length) break;
        for(const item of batch)all[item.id]=item.value;offset+=batch.length;
      }
      return all;
    },
    sourceKey:JSON.stringify([folder,namespace,env('DROPBOX_APP_KEY')])});} while(status==='importando' && Date.now()<until);
   return Response.json({status});
 }catch{return Response.json({status:'error'},{status:503});}
});
