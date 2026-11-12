export type Connection = { origin: string; key: string };
export type Session = { access: string; refresh: string; expires: number };
export type Payment = {
  id: string; periodo: string; titular: string; inmueble: string; estado: string;
  importe_registrado: number | null; fechas_pago: string[]; recibos: string[];
  ventana_pago: string | null; vencimiento: string | null; evidencia: string[];
};
export type Sync = {
  estado: string; ultima_verificacion: string | null; intento_en: string | null; mensaje: string | null;
};

export function publicConnection(origin: string, publicKey: string): Connection {
  const url = origin.trim().replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
    throw new Error('Ingresá la URL HTTPS del proyecto, por ejemplo https://proyecto.supabase.co.');
  }
  const key = publicKey.trim();
  let allowed = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!allowed) {
    const parts = key.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        allowed = payload.role === 'anon' && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(key);
      } catch { allowed = false; }
    }
  }
  if (!allowed) throw new Error('Usá la clave pública publishable o anon del proyecto.');
  return { origin: url, key };
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export async function tokenRequest(config: Connection, grant: 'password' | 'refresh_token',
  body: Record<string, string>, signal?: AbortSignal): Promise<Session> {
  const res = await fetch(config.origin + '/auth/v1/token?grant_type=' + grant, {
    method: 'POST', headers: { apikey: config.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', redirect: 'error',
    referrerPolicy: 'no-referrer', signal
  });
  if (!res.ok) throw new ApiError(res.status, res.status === 429 ? 'Demasiados intentos. Volvé a probar en unos minutos.' :
    grant === 'password' ? 'No se pudo iniciar sesión. Revisá tu correo, contraseña y acceso al proyecto.' : 'Tu sesión venció. Volvé a ingresar.');
  const token = await res.json() as Record<string, unknown> | null;
  if (!token || typeof token.access_token !== 'string' || typeof token.refresh_token !== 'string' || typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
    throw new Error('Supabase no devolvió una sesión válida.');
  }
  return { access: token.access_token, refresh: token.refresh_token, expires: Date.now() + token.expires_in * 1000 };
}

async function request(config: Connection, session: Session, resource: string, query: URLSearchParams, signal: AbortSignal) {
  const res = await fetch(config.origin + '/rest/v1/' + resource + '?' + query, {
    headers: { apikey: config.key, Authorization: 'Bearer ' + session.access, Prefer: 'count=exact' },
    signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer'
  });
  if (!res.ok) {
    const message = res.status === 401 ? 'Tu sesión venció. Volvé a ingresar.' :
      res.status === 403 ? 'Tu cuenta no tiene permiso para consultar este panel.' :
      res.status === 404 ? 'El proyecto todavía no tiene las tablas del control de pagos.' :
      'No se pudo consultar Supabase. Se volverá a intentar en un minuto.';
    throw new ApiError(res.status, message);
  }
  const items = await res.json();
  if (!Array.isArray(items)) throw new Error('La respuesta de Supabase tiene un formato inesperado.');
  return { items, range: res.headers.get('content-range') };
}

export async function readMonth(config: Connection, session: Session, month: string, signal: AbortSignal) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Seleccioná un período válido.');
  const query = new URLSearchParams({
    select: 'id,periodo,titular,inmueble,estado,importe_registrado,fechas_pago,recibos,ventana_pago,vencimiento,evidencia',
    or: `(periodo.eq.${month},periodo.eq.*)`, order: 'id.asc', limit: '200'
  });
  const rows: Payment[] = [];
  const ids = new Set<string>();
  for (;;) {
    query.set('offset', String(rows.length));
    const { items, range } = await request(config, session, 'control_periodos', query, signal);
    for (const item of items) {
      if (typeof item.id !== 'string' || ids.has(item.id) || !Array.isArray(item.fechas_pago) ||
          !Array.isArray(item.recibos) || !Array.isArray(item.evidencia)) {
        throw new Error('La lectura cambió o tiene un formato inesperado. Volvé a actualizar.');
      }
      ids.add(item.id);
      rows.push(item as Payment);
    }
    const match = range?.match(/\/(\d+)$/);
    if (match && rows.length >= Number(match[1])) break;
    if (!items.length) break;
    // Without an exact count, continue even for a short page: the server may cap the limit.
  }
  return rows;
}

export async function readSync(config: Connection, session: Session, signal: AbortSignal): Promise<Sync | null> {
  const query = new URLSearchParams({ select: 'estado,ultima_verificacion,intento_en,mensaje', limit: '1' });
  const { items } = await request(config, session, 'control_sync_estado', query, signal);
  return items[0] ?? null;
}

export function syncLabel(state: Sync | null, now: number): string {
  if (!state) return 'Todavía no hay una comprobación de Dropbox visible para esta cuenta.';
  if (state.estado === 'error') return 'Falló la última sincronización con Dropbox.';
  const t = Date.parse(state.ultima_verificacion ?? '');
  if (!Number.isFinite(t) || t > now) return 'Pendiente de la primera sincronización completa.';
  if (now - t >= 5 * 60000) return 'Los datos pueden estar desactualizados: hace más de cinco minutos que no se comprueba Dropbox.';
  if (state.estado === 'syncing') return 'Se están comprobando los cambios de Dropbox.';
  return state.estado === 'ok' ? 'Cambios de Dropbox comprobados.' : 'Estado de sincronización sin confirmar.';
}
