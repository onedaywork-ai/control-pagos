'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, publicConnection, readMonth, readSync, syncLabel, tokenRequest,
  type Connection, type Payment, type Session, type Sync } from '../lib/control-remoto';

const configKey = 'scaffidi.control.conexion.v1';
const zone = 'America/Argentina/Mendoza';
const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
const clock = new Intl.DateTimeFormat('es-AR', { timeZone: zone, dateStyle: 'short', timeStyle: 'medium' });
const date = (value: string | null) => value ? value.split('-').reverse().join('/') : 'Sin determinar';
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const periodNow = () => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit' }).format(new Date());
const states = ['PAGADO', 'PAGO PARCIAL', 'COBRO REGISTRADO', 'SIN COBRO REGISTRADO — PLAZO VENCIDO', 'EN PLAZO', 'PRÓXIMO', 'REVISAR'];

type Login = { token: Session; renewal?: Promise<Session> };
type Snapshot = { month: string; rows: Payment[]; sync: Sync | null; receivedAt: number };

function freshToken(config: Connection, login: Login): Promise<Session> {
  if (login.token.expires > Date.now() + 45000) return Promise.resolve(login.token);
  if (!login.renewal) {
    login.renewal = tokenRequest(config, 'refresh_token', { refresh_token: login.token.refresh }, AbortSignal.timeout(20000))
      .then(session => { login.token = session; return session; })
      .finally(() => { login.renewal = undefined; });
  }
  return login.renewal;
}

export default function ControlRemoto() {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<Connection | null>(null);
  const [login, setLogin] = useState<Login | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [month, setMonth] = useState(periodNow);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [now, setNow] = useState<number>(0);
  const refreshAction = useRef<() => void>(() => {});

  useEffect(() => {
    // The project address and its publishable key are the only saved values.
    try {
      const saved = localStorage.getItem(configKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        setConfig(publicConnection(parsed.origin, parsed.key));
      } else if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
        setConfig(publicConnection(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY));
      }
    } catch { setNotice('Revisá la configuración pública del proyecto de Supabase.'); }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!login || !config) return;
    let active = true, busy = false;
    const controller = new AbortController();
    const update = async () => {
      if (!active || busy) return;
      busy = true;
      setLoading(true);
      try {
        const session = await freshToken(config, login);
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
        const [rows, sync] = await Promise.all([readMonth(config, session, month, signal), readSync(config, session, signal)]);
        if (active) {
          const receivedAt = Date.now();
          setSnapshot({ month, rows, sync, receivedAt });
          setNow(receivedAt);
          setRefreshError('');
        }
      } catch (err) {
        if (active) {
          if (err instanceof ApiError && [400, 401, 403].includes(err.status)) {
            setSnapshot(null); setLogin(null);
            setNotice(err.message);
          } else {
            setRefreshError(err instanceof ApiError ? err.message : 'No se pudo actualizar la consulta. Comprobá la conexión.');
          }
        }
      } finally { busy = false; if (active) setLoading(false); }
    };
    const onFocus = () => { if (!document.hidden) { setNow(Date.now()); void update(); } };
    setRefreshError('');
    refreshAction.current = update;
    void update();
    const pulse = window.setInterval(() => setNow(Date.now()), 10000);
    const poll = window.setInterval(onFocus, 60000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      active = false; controller.abort(); refreshAction.current = () => {};
      clearInterval(poll); clearInterval(pulse);
      window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus);
    };
  }, [config, login, month]);

  function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const saved = publicConnection(String(data.get('origin')), String(data.get('key')));
      try { localStorage.setItem(configKey, JSON.stringify(saved)); } catch { /* In private browsing the connection remains valid for this page. */ }
      setConfig(saved); setNotice('');
    } catch (err) {
      form.querySelector<HTMLInputElement>('input[name="key"]')!.value = '';
      setNotice(err instanceof Error ? err.message : 'No se pudo configurar el proyecto.');
    }
  }
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config || passwordBusy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setPasswordBusy(true); setNotice('');
    try {
      const token = await tokenRequest(config, 'password', { email: String(data.get('email')).trim(), password: String(data.get('password')) }, AbortSignal.timeout(20000));
      form.reset(); setLogin({ token });
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'No se pudo conectar con el proyecto de Supabase.');
    } finally { setPasswordBusy(false); }
  }
  function signOut() {
    if (config && login) {
      void fetch(config.origin + '/auth/v1/logout?scope=local', {
        method: 'POST', headers: { apikey: config.key, Authorization: 'Bearer ' + login.token.access },
        credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer'
      }).catch(() => {});
    }
    setLogin(null); setSnapshot(null); setSearch(''); setFilter(''); setRefreshError(''); setNotice('');
  }
  const current = snapshot?.month === month ? snapshot : null;
  const rows = current?.rows ?? [];
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.estado, (totals.get(row.estado) ?? 0) + 1);
  const query = normalize(search.trim());
  const visible = rows.filter(row => (!filter || row.estado === filter) &&
    (!query || normalize([row.titular, row.inmueble, ...row.recibos].join(' ')).includes(query)));
  const stamp = Date.parse(current?.sync?.ultima_verificacion ?? '');
  const description = syncLabel(current?.sync ?? null, now);

  return <main className="daily-control" aria-label="Control remoto de alquileres">
    <style>{`
      .daily-control {max-width:1250px}
      .daily-control h1 {letter-spacing:-.025em}
      .daily-control section.scroll {background:white;border:1px solid #d6dde5;border-radius:6px}
      .daily-control td {vertical-align:top}
      .daily-control td:nth-child(2) {font-weight:650}
      .daily-control .month-counts {display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}
      .daily-control .month-counts span {padding:7px 10px;background:#e7eef3;border-radius:4px;font-size:13px}
      @media(max-width:680px){
        .daily-control {padding:14px}
        .daily-control header {align-items:flex-start}
        .daily-control .tools {display:grid;grid-template-columns:1fr 1fr}
        .daily-control .tools label {min-width:0}
        .daily-control .tools input,.daily-control .tools select {width:100%}
        .daily-control table,.daily-control tbody,.daily-control tr,.daily-control td{display:block}
        .daily-control thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
        .daily-control section.scroll{overflow:visible;background:transparent;border:0}
        .daily-control tbody tr{padding:12px;background:white;border:1px solid #d6dde5;border-radius:6px;margin-bottom:10px}
        .daily-control tbody td{border:0;padding:5px 2px;line-height:1.4;overflow-wrap:anywhere}
        .daily-control td[data-label]::before{content:attr(data-label);display:block;font-size:12px;color:#52677b;font-weight:500}
      }
    `}</style>
    <header><div><p className="eyebrow">SCAFFIDI PROPIEDADES</p><h1>Control diario de alquileres</h1></div>
      {login && <button onClick={signOut}>Cerrar sesión</button>}</header>
    {notice && <p className="error" role="alert">{notice}</p>}
    {!ready ? <p>Abriendo el panel…</p> : !config ? <section className="notice">
      <h2>Conectar el panel de la inmobiliaria</h2>
      <p>Ingresá la URL y la clave pública del proyecto Supabase que recibe los cambios de Dropbox.</p>
      <form className="tools" onSubmit={configure}>
        <label>URL del proyecto<input required name="origin" type="url" placeholder="https://proyecto.supabase.co" spellCheck={false} /></label>
        <label>Clave pública publishable o anon<input required name="key" type="password" autoComplete="off" /></label>
        <button type="submit">Guardar conexión</button>
      </form>
    </section> : !login ? <section className="notice"><h2>Ingresá con tu cuenta</h2>
      <p>Proyecto de la inmobiliaria: {new URL(config.origin).hostname}</p>
      <form className="tools" onSubmit={signIn}>
        <label>Correo electrónico<input required name="email" type="email" autoComplete="username" /></label>
        <label>Contraseña<input required name="password" type="password" autoComplete="current-password" /></label>
        <button type="submit" disabled={passwordBusy}>{passwordBusy ? 'Ingresando…' : 'Ingresar'}</button>
      </form>
      <button disabled={passwordBusy} onClick={() => { try { localStorage.removeItem(configKey); } catch {} setConfig(null); setNotice(''); }}>Cambiar proyecto</button>
    </section> : <>
      <section className="notice" aria-live="polite">
        <strong>{current ? description : loading ? 'Consultando el período…' : 'Sin lectura disponible.'}</strong>
        {Number.isFinite(stamp) && <p>Última comprobación de Dropbox: <b>{clock.format(stamp)}</b> (Mendoza).</p>}
        {current?.sync?.estado === 'error' && current.sync.mensaje && <p>{current.sync.mensaje}</p>}
        {refreshError && <p className="warning" role="alert">{refreshError}{current ? ' Se muestra la lectura anterior.' : ''}</p>}
      </section>
      <div className="tools">
        <label>Período<input type="month" value={month} required onChange={event => { if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value); }} /></label>
        <label>Estado<select value={filter} onChange={event => setFilter(event.target.value)}><option value="">Todos</option>
          {Array.from(new Set([...states, ...totals.keys()])).map(state => <option key={state}>{state}</option>)}</select></label>
        <label>Buscar ficha<input type="search" value={search} placeholder="Titular, inmueble o recibo" onChange={event => setSearch(event.target.value)} /></label>
        <button disabled={loading} onClick={() => refreshAction.current()}>{loading ? 'Consultando…' : 'Actualizar'}</button>
      </div>
      {current && <><div className="month-counts" aria-label="Resumen del período"><span><b>{rows.length}</b> fichas</span>{[...totals].map(([name, total]) => <span key={name}><b>{total}</b> · {name.toLocaleLowerCase('es-AR')}</span>)}</div>
        {visible.length ? <section className="scroll"><table>
          <thead><tr><th>Titular e inmueble</th><th>Estado</th><th>Cobro</th><th>Fecha de pago</th><th>Ventana y vencimiento</th></tr></thead>
          <tbody>{visible.map(row => <tr key={row.id}>
            <td><strong>{row.titular}</strong><small>{row.inmueble}</small>
              {row.evidencia.length > 0 && <details><summary>Ver evidencia</summary><ul>{row.evidencia.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}</td>
            <td data-label="Estado">{row.estado}</td><td data-label="Importe registrado">{row.importe_registrado == null ? 'Sin determinar' : money.format(row.importe_registrado)}
              {row.recibos.length > 0 && <small>Recibos: {row.recibos.join(', ')}</small>}</td>
            <td data-label="Fechas de pago">{row.fechas_pago.length ? row.fechas_pago.map(date).join(' · ') : 'Sin pago registrado'}</td>
            <td data-label="Ventana de pago">{row.ventana_pago || 'Sin ventana identificada'}<small>Vence: {date(row.vencimiento)}</small></td>
          </tr>)}</tbody>
        </table></section> : <p>{rows.length ? 'Ninguna ficha coincide con los filtros.' : 'Sin fichas disponibles para este período.'}</p>}
      </>}
    </>}
  </main>;
}
