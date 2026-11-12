import assert from 'node:assert/strict';
import test from 'node:test';
import { publicConnection, readMonth, syncLabel } from '../lib/control-remoto.ts';

const origin = 'https://proyecto.supabase.co';
const encode = (role: string) => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.test';
test('solo guarda orígenes Supabase HTTPS y claves públicas', () => {
  assert.equal(publicConnection(origin + '/', 'sb_publishable_prueba').origin, origin);
  assert.equal(publicConnection(origin, encode('anon')).key, encode('anon'));
  for (const unsafe of ['http://proyecto.supabase.co', origin + '.example.com', origin + '/ruta', 'https://evil.com@proyecto.supabase.co']) {
    assert.throws(() => publicConnection(unsafe, encode('anon')));
  }
  for (const secret of ['sb_secret_invalida', encode('service_role'), encode('authenticated')]) {
    assert.throws(() => publicConnection(origin, secret));
  }
});
test('la frescura se calcula desde el último éxito en Dropbox', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  const good = { estado: 'ok', ultima_verificacion: '2026-11-11T11:59:30Z', intento_en: null, mensaje: null };
  assert.match(syncLabel(good, now), /comprobados/);
  assert.match(syncLabel(good, now + 300000), /desactualizados/);
  assert.match(syncLabel({ ...good, estado: 'error' }, now), /Falló/);
  assert.match(syncLabel({ ...good, ultima_verificacion: null }, now), /Pendiente/);
});
test('lee todas las páginas y conserva los casos sin período', async t => {
  const offsets: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.searchParams.get('or'), '(periodo.eq.2026-11,periodo.eq.*)');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer usuario');
    const offset = url.searchParams.get('offset')!;
    offsets.push(offset);
    const ids = offset === '0' ? ['uno', 'dos'] : ['tres'];
    return Response.json(ids.map(id => ({ id, fechas_pago: [], recibos: [], evidencia: [] })), {
      headers: { 'Content-Range': offset === '0' ? '0-1/3' : '2-2/3' }
    });
  });
  const rows = await readMonth(publicConnection(origin, 'sb_publishable_prueba'),
    { access: 'usuario', refresh: 'otro', expires: 123 }, '2026-11', new AbortController().signal);
  assert.deepEqual(offsets, ['0', '2']);
  assert.deepEqual(rows.map(r=>r.id),['uno','dos','tres']);
});
