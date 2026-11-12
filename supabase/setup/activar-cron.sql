-- Ejecutar después de desplegar dropbox-sync y guardar en Vault sc_project_url y sc_sync_secret.
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ begin
 if coalesce((select length(decrypted_secret) from vault.decrypted_secrets where name='sc_sync_secret'),0)<32
    or coalesce((select decrypted_secret from vault.decrypted_secrets where name='sc_project_url'),'') !~ '^https://[a-z0-9-]+\.supabase\.co$'
 then raise exception 'Configurar la URL y el secreto de sincronización en Vault'; end if;
end $$;
select cron.schedule('scaffidi-dropbox-cargadas','* * * * *',$job$
 select net.http_post(
   url := (select decrypted_secret from vault.decrypted_secrets where name='sc_project_url')||'/functions/v1/dropbox-sync',
   headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
     (select decrypted_secret from vault.decrypted_secrets where name='sc_sync_secret')),
   body := '{}'::jsonb,timeout_milliseconds := 120000);
$job$);
