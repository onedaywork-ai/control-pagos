// Run locally on a trusted administrator's device with Node 24.
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';
const rl=createInterface({input:process.stdin,output:process.stdout});
try {
 const origin=(await rl.question('URL de tu proyecto Supabase: ')).trim().replace(/\/$/,'');
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(origin))throw Error('URL de proyecto inválida.');
 const key=(await rl.question('App key pública de Dropbox: ')).trim();
 if(!/^[a-zA-Z0-9_-]+$/.test(key))throw Error('App key inválida.');
 const folder=(await rl.question('Ruta de CARGADAS dentro de Dropbox o del namespace elegido (empieza con /): ')).trim();
 if(!folder.startsWith('/')||/[\r\n"\\$]/.test(folder))throw Error('Ruta inválida.');
 const namespace=(await rl.question('Namespace de Dropbox si la carpeta está compartida (Enter para omitir): ')).trim();
 if(namespace && !/^\d+$/.test(namespace))throw Error('Namespace inválido.');
 const verifier=randomBytes(48).toString('base64url');
 const challenge=createHash('sha256').update(verifier).digest('base64url');
 const params=new URLSearchParams({client_id:key,response_type:'code',token_access_type:'offline',scope:'files.metadata.read files.content.read',code_challenge_method:'S256',code_challenge:challenge});
 console.log('Abrí este enlace en Dropbox y autorizá la lectura:\nhttps://www.dropbox.com/oauth2/authorize?'+params);
 const code=(await rl.question('Pegá acá el código que muestra Dropbox: ')).trim();
 const res=await fetch('https://api.dropboxapi.com/oauth2/token',{method:'POST',body:new URLSearchParams({client_id:key,grant_type:'authorization_code',code,code_verifier:verifier}),signal:AbortSignal.timeout(20000)});
 if(!res.ok)throw Error('Dropbox rechazó el código. Volvé a iniciar la autorización.');
 const {refresh_token:token}=await res.json();
 if(typeof token!=='string'||!/^[\w.~-]+$/.test(token))throw Error('Dropbox no devolvió un token offline válido.');
 const sync=randomBytes(32).toString('hex'), parent=path.join(homedir(),'.scaffidi-control');
 await mkdir(parent,{recursive:true,mode:0o700});const dir=await mkdtemp(path.join(parent,'conexion-'));
 await writeFile(path.join(dir,'dropbox.private.env'),[
 'DROPBOX_APP_KEY='+key,'DROPBOX_REFRESH_TOKEN='+token,'DROPBOX_FOLDER="'+folder+'"','DROPBOX_NAMESPACE_ID='+namespace,'SC_SYNC_SECRET='+sync
 ].join('\n')+'\n',{mode:0o600});
 const vaultSql=(name,value)=>`do $$ declare sid uuid; begin select id into sid from vault.secrets where name='${name}'; if sid is null then perform vault.create_secret('${value}','${name}'); else perform vault.update_secret(sid,'${value}'); end if; end $$;`;
 await writeFile(path.join(dir,'configurar-vault.sql'),vaultSql('sc_project_url',origin)+'\n'+vaultSql('sc_sync_secret',sync)+'\n',{mode:0o600});
 console.log('Autorización guardada en '+dir+'. Seguí la guía de activación.');
} finally {rl.close();}
