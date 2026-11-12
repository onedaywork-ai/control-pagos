-- Owner-only provisioning. No client has access to raw workbooks, cursors or write RPCs.
create schema if not exists sc_private;
revoke all on schema sc_private from public, anon, authenticated;
create table public.sc_members(user_id uuid primary key references auth.users on delete cascade);
alter table public.sc_members enable row level security;
revoke all on public.sc_members from public, anon, authenticated;
grant select on public.sc_members to authenticated;
create policy member_self on public.sc_members for select to authenticated using (user_id=(select auth.uid()));

create table public.control_periodos (
 id text primary key, family text not null, periodo text not null, titular text not null, inmueble text,
 estado text not null, importe_registrado numeric, fechas_pago jsonb not null default '[]',
 recibos jsonb not null default '[]', ventana_pago text, vencimiento date, evidencia jsonb not null default '[]'
);
create index sc_periodo on public.control_periodos(periodo,id);
create index sc_period_family on public.control_periodos(family);
create table public.control_sync_estado (
 id int primary key check(id=1),estado text not null, ultima_verificacion timestamptz, intento_en timestamptz, mensaje text
);
insert into public.control_sync_estado(id,estado) values(1,'pending');
alter table public.control_periodos enable row level security;
alter table public.control_sync_estado enable row level security;
revoke all on public.control_periodos,public.control_sync_estado from public,anon,authenticated;
grant select on public.control_periodos,public.control_sync_estado to authenticated;
create policy sc_read_periods on public.control_periodos for select to authenticated
 using (exists(select 1 from public.sc_members where user_id=(select auth.uid())));
create policy sc_read_status on public.control_sync_estado for select to authenticated
 using (exists(select 1 from public.sc_members where user_id=(select auth.uid())));

create table public.sc_sync (
 id int primary key check(id=1), cursor text, pending jsonb, source_key text, full_scan boolean not null default true,
 lease uuid, lease_until timestamptz, full_scan_date date
);
insert into public.sc_sync(id) values(1);
create table sc_private.files (
 path text primary key,name text not null,rev text not null,modified timestamptz not null,
 family text not null,conflict boolean not null,reading jsonb not null,snapshot jsonb not null,error text,parsed jsonb
);
create index sc_files_family on sc_private.files(family);
create table sc_private.stage(like sc_private.files including all);
create table sc_private.removals(path text primary key);
create table public.sc_validations(id text primary key, value jsonb not null);
alter table public.sc_sync enable row level security;
alter table public.sc_validations enable row level security;
revoke all on public.sc_sync, public.sc_validations from public,anon,authenticated;
grant select on public.sc_sync,public.sc_validations to service_role;
grant insert,update,delete on public.sc_validations to service_role;

create function sc_private.refresh_family(f text) returns void language plpgsql set search_path='' as $$
declare chosen sc_private.files%rowtype; problems text; count_files int;
begin
 delete from public.control_periodos where family=f;
 select count(*),string_agg(error,'; ') into count_files,problems from sc_private.files where family=f;
 if count_files=0 then return; end if;
 if problems is null then
   select a.* into chosen from sc_private.files a where a.family=f and not exists (
    select 1 from sc_private.files b where b.family=f and
    (not(a.snapshot @> b.snapshot) or (a.snapshot<>b.snapshot and a.modified<=b.modified)))
    order by a.conflict asc,a.modified desc,a.path limit 1;
 end if;
 if chosen.path is null then
   insert into public.control_periodos(id,family,periodo,titular,estado,evidencia)
   values(f||'|*',f,'*',f,'REVISAR',jsonb_build_array(coalesce(problems,'Las versiones tienen cambios incompatibles. Revisar antes de sumar cobros.')));
 else
   insert into public.control_periodos(id,family,periodo,titular,inmueble,estado,importe_registrado,fechas_pago,recibos,ventana_pago,vencimiento,evidencia)
   select f||'|'||ord::text,f,v->>'periodo',v->>'titular',v->>'inmueble',v->>'estado',(v->>'importe_registrado')::numeric,
    v->'fechas_pago',v->'recibos',v->>'ventana_pago',(v->>'vencimiento')::date,v->'evidencia'
   from jsonb_array_elements(chosen.reading) with ordinality as row_item(v,ord);
 end if;
end $$;

create function public.sc_claim_sync() returns uuid language plpgsql security definer set search_path='' as $$
declare token uuid := gen_random_uuid();
begin
 update public.sc_sync set lease=token,lease_until=clock_timestamp()+interval '140 seconds'
 where id=1 and (lease is null or lease_until<clock_timestamp());
 if not found then return null; end if;
 update public.control_sync_estado set estado='syncing',intento_en=clock_timestamp() where id=1;
 return token;
end $$;

create function public.sc_commit_sync(p_lease uuid,p_files jsonb,p_deleted text[],p_cursor text,p_complete boolean,
 p_full_scan boolean,p_restart boolean,p_pending jsonb,p_source_key text,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
declare f text; rec record; affected text[];
begin
 perform 1 from public.sc_sync where id=1 and lease=p_lease and lease_until>=clock_timestamp() for update;
 if not found then raise exception 'lease expired'; end if;
 if p_error is not null then
  update public.control_sync_estado set estado='error',mensaje=left(p_error,400) where id=1;
 else
  if p_restart then truncate sc_private.stage,sc_private.removals; end if;
  delete from sc_private.stage where path=any(p_deleted);
  insert into sc_private.removals select unnest(p_deleted) on conflict do nothing;
  for rec in select * from jsonb_to_recordset(p_files) as x(path text,name text,rev text,modified timestamptz,family text,conflict boolean,reading jsonb,snapshot jsonb,error text,parsed jsonb) loop
   delete from sc_private.removals where path=rec.path;
   insert into sc_private.stage values(rec.path,rec.name,rec.rev,rec.modified,rec.family,rec.conflict,rec.reading,rec.snapshot,rec.error,rec.parsed)
   on conflict(path) do update set name=excluded.name,rev=excluded.rev,modified=excluded.modified,family=excluded.family,conflict=excluded.conflict,
   reading=excluded.reading,snapshot=excluded.snapshot,error=excluded.error,parsed=excluded.parsed;
  end loop;
  if p_complete then
   select array(select family from sc_private.stage union select family from sc_private.files where p_full_scan
    or path in(select path from sc_private.removals union select path from sc_private.stage)) into affected;
   delete from sc_private.files where p_full_scan or path in(select path from sc_private.removals union select path from sc_private.stage);
   insert into sc_private.files select * from sc_private.stage;
   foreach f in array affected loop perform sc_private.refresh_family(f); end loop;
   truncate sc_private.stage,sc_private.removals;
  end if;
  update public.sc_sync set cursor=p_cursor,pending=p_pending,source_key=p_source_key,full_scan=p_full_scan and not p_complete,
   full_scan_date=case when p_full_scan and p_complete then (now() at time zone 'America/Argentina/Mendoza')::date else full_scan_date end where id=1;
  update public.control_sync_estado set estado=case when p_complete then 'ok' else 'syncing' end,
   ultima_verificacion=case when p_complete then clock_timestamp() else ultima_verificacion end,
   mensaje=case when p_complete then null else 'Importando cambios de Dropbox.' end where id=1;
 end if;
 update public.sc_sync set lease=null,lease_until=null where id=1;
end $$;
revoke all on function public.sc_claim_sync(),public.sc_commit_sync(uuid,jsonb,text[],text,boolean,boolean,boolean,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.sc_claim_sync(),public.sc_commit_sync(uuid,jsonb,text[],text,boolean,boolean,boolean,jsonb,text,text) to service_role;

create function public.sc_cached(p_path text,p_rev text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('parsed',parsed,'snapshot',snapshot) from sc_private.files
 where path=p_path and rev=p_rev and error is null and parsed is not null
$$;
revoke all on function public.sc_cached(text,text) from public,anon,authenticated;
grant execute on function public.sc_cached(text,text) to service_role;
