// Isolated PostgreSQL/WASM test. No production project, API keys or network access.
// Install @electric-sql/pglite for development, or set SC_PGLITE_ENTRY to its dist/index.js.
// node --test supabase/tests/control-db.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const moduleName = process.env.SC_PGLITE_ENTRY
  ? pathToFileURL(process.env.SC_PGLITE_ENTRY).href : '@electric-sql/pglite';
const { PGlite } = await import(moduleName);
const migration = await readFile(new URL('../migrations/202611120001_control.sql', import.meta.url), 'utf8');

const member = '597eff1f-91ab-4c89-b398-e80585e45396';
const outsider = '76452163-d6c4-4bd2-8bbe-cd74b2407e9d';
const authFixture = `
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
  $$;
  grant usage on schema auth to authenticated, anon;
  insert into auth.users values ('${member}'), ('${outsider}');
`;

function file({ path = '/regular.xlsx', family = 'contrato', conflict = false,
  modified = '2026-11-01T00:00:00Z', snapshot = { A1: 'canon', B1: 'recibo 12' },
  amount = 500, error = null } = {}) {
  const reading = [{
    periodo: '2026-11', titular: 'Muestra', inmueble: 'Unidad de prueba', estado: 'COBRO REGISTRADO',
    importe_registrado: amount, fechas_pago: ['2026-11-03'], recibos: ['12'],
    ventana_pago: 'Del 1 al 10', vencimiento: '2026-11-10', evidencia: ['PAGOS!E3']
  }];
  return { path, name: path.slice(1), family, conflict, rev: modified, modified, snapshot, reading, error };
}

test('la migración protege los datos y publica ciclos completos de sincronización', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(authFixture);
  await db.exec(migration);
  await db.query('insert into public.sc_members(user_id) values($1)', [member]);

  const role = async (name, uid = '') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
    await db.exec('set role ' + name);
  };
  const claim = async () => (await db.query('select public.sc_claim_sync() as token')).rows[0].token;
  const commit = (token, { files = [], deleted = [], cursor = 'c1', complete = true, full = false,
    restart = true, pending = null, error = null } = {}) =>
    db.query(`select public.sc_commit_sync($1::uuid,$2::jsonb,$3::text[],$4::text,$5::boolean,
      $6::boolean,$7::boolean,$8::jsonb,$9::text,$10::text)`,
      [token, JSON.stringify(files), deleted, cursor, complete, full, restart,
        pending == null ? null : JSON.stringify(pending), 'source-a', error]);
  const periods = async () => (await db.query('select * from public.control_periodos order by id')).rows;
  const status = async () => (await db.query('select * from public.control_sync_estado')).rows[0];

  await t.test('la publicación inicial espera todas las páginas y bloquea trabajadores simultáneos', async () => {
    await role('service_role');
    const token = await claim();
    assert.ok(token);
    assert.equal(await claim(), null);
    await commit(token, { files: [file()], full: true, complete: false, pending: { after: 'page-1' } });
    await assert.rejects(commit(token), /lease expired/i);
    await role('authenticated', member);
    assert.deepEqual(await periods(), []);
    assert.equal((await status()).estado, 'syncing');
    assert.equal((await status()).ultima_verificacion, null);

    await role('service_role');
    const pending = (await db.query('select cursor, pending, full_scan from public.sc_sync')).rows[0];
    assert.equal(pending.cursor, 'c1');
    assert.deepEqual(pending.pending, { after: 'page-1' });
    assert.equal(pending.full_scan, true);
    await commit(await claim(), { full: true, restart: false, cursor: 'c2',
      files: [file({ path: '/segundo.xlsx', family: 'otro' })] });
    await role('authenticated', member);
    const data = await periods();
    assert.equal(data.length, 2);
    assert.equal(Number(data[0].importe_registrado), 500);
    assert.deepEqual(data[0].recibos, ['12']);
    assert.equal((await status()).estado, 'ok');
    assert.ok((await status()).ultima_verificacion);
  });

  await t.test('el miembro solo lee, otro usuario no ve fichas, anon no tiene acceso', async () => {
    await role('authenticated', member);
    assert.equal((await db.query('select user_id from public.sc_members')).rows.length, 1);
    await assert.rejects(db.exec("update public.control_periodos set titular='cambio'"), /permission denied/i);
    await assert.rejects(db.exec('select public.sc_claim_sync()'), /permission denied/i);
    await assert.rejects(db.exec('select * from public.sc_sync'), /permission denied/i);
    await assert.rejects(db.exec('select * from public.sc_validations'), /permission denied/i);
    await assert.rejects(db.exec('select * from sc_private.files'), /permission denied/i);
    await role('authenticated', outsider);
    assert.deepEqual(await periods(), []);
    assert.deepEqual((await db.query('select * from public.control_sync_estado')).rows, []);
    assert.deepEqual((await db.query('select * from public.sc_members')).rows, []);
    await assert.rejects(db.query('insert into public.sc_members values ($1)', [outsider]), /permission denied/i);
    await role('anon');
    await assert.rejects(periods(), /permission denied/i);
    await assert.rejects(db.exec('select * from public.control_sync_estado'), /permission denied/i);
    await assert.rejects(db.exec('select public.sc_claim_sync()'), /permission denied/i);
  });

  await t.test('un delta compara copias y no suma dos versiones del mismo pago', async () => {
    const copy = file({ path: '/conflicto.xlsx', conflict: true, modified: '2026-11-05T00:00:00Z',
      snapshot: { A1:'canon', B1:'recibo 12', C1:'nuevo movimiento' }, amount: 750 });
    await role('service_role');
    await commit(await claim(), { files: [copy], cursor: 'c3' });
    await role('authenticated', member);
    let data = await periods();
    assert.equal(data.length, 2);
    assert.equal(Number(data[0].importe_registrado), 750);
    assert.equal(Number(data[1].importe_registrado), 500);

    await role('service_role');
    await commit(await claim(), { files: [{ ...copy, snapshot: { A1:'otro canon' } }], cursor: 'c4' });
    await role('authenticated', member);
    data = await periods();
    assert.equal(data[0].periodo, '*');
    assert.equal(data[0].estado, 'REVISAR');
    assert.equal(data[0].importe_registrado, null);

    await role('service_role');
    await commit(await claim(), { deleted: ['/regular.xlsx'], cursor: 'c5' });
    await role('authenticated', member);
    data = await periods();
    assert.equal(data[0].periodo, '2026-11');
    assert.equal(Number(data[0].importe_registrado), 750);
    await role('service_role');
    await commit(await claim(), { deleted: ['/conflicto.xlsx'], cursor: 'c6' });
    await role('authenticated', member);
    assert.deepEqual((await periods()).map(p => p.family), ['otro']);
  });

  await t.test('ante un error conserva el último éxito y las filas del panel; un lease vencido no escribe', async () => {
    await role('authenticated', member);
    const lastSuccess = (await status()).ultima_verificacion;
    await role('service_role');
    const abandoned = await claim();
    await db.exec('reset role');
    await db.exec("update public.sc_sync set lease_until=clock_timestamp()-interval '1 minute'");
    await role('service_role');
    const replacement = await claim();
    assert.notEqual(abandoned, replacement);
    await assert.rejects(commit(abandoned, { deleted:['/segundo.xlsx'] }), /lease expired/i);
    await commit(replacement, { error:'Dropbox temporalmente inaccesible', cursor:'no debe avanzar' });
    assert.equal((await db.query('select cursor from public.sc_sync')).rows[0].cursor, 'c6');
    await role('authenticated', member);
    const state = await status();
    assert.equal(state.estado, 'error');
    assert.deepEqual(state.ultima_verificacion, lastSuccess);
    assert.deepEqual((await periods()).map(p => p.family), ['otro']);

    await role('service_role');
    await commit(await claim(), { full:true, cursor:'c7', files:[] });
    await role('authenticated', member);
    assert.equal((await status()).estado, 'ok');
    assert.deepEqual(await periods(), []);
  });
});
