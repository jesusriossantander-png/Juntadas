/**
 * Grupo compartido en Supabase.
 * Cada grupo se identifica con un código secreto que viaja en el link de invitación.
 * La app nunca accede a las tablas: solo llama funciones que exigen ese código.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { validar, type Datos, type Juntada } from './juntada';

const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://srgsnprtetkzosmcqneb.supabase.co';
const KEY = (import.meta.env.VITE_SUPABASE_KEY as string | undefined) || 'sb_publishable_uaGoNU5Lry-3pSyGeE1G1Q_bQqjhI3M';
/** Clave pública para los avisos (la privada vive solo en el servidor). */
export const VAPID_PUBLICA =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ||
  'BB-fz5PjOUU3tmUjq8LnhYVE8LIjopzN4vcUPPOcDbH5hjCHilLgjJ1vjZfUJoJvlLLG6gn7EnxEtRCp4g8oVp4';

const GRUPO_KEY = 'la-juntada:grupo';

let cliente: SupabaseClient | null = null;
const sb = () => (cliente ??= createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } }));

export const codigoGuardado = () => {
  try {
    return localStorage.getItem(GRUPO_KEY);
  } catch {
    return null;
  }
};
export const guardarCodigo = (c: string | null) => {
  try {
    if (c) localStorage.setItem(GRUPO_KEY, c);
    else localStorage.removeItem(GRUPO_KEY);
  } catch {
    /* nada */
  }
};
export const linkInvitacion = (codigo: string) => `${location.origin}${location.pathname}?g=${codigo}`;

/** Lee el código de un link de invitación (?g=...) y lo quita de la barra de direcciones. */
export function codigoDelLink(): string | null {
  const g = new URLSearchParams(location.search).get('g');
  if (!g || !/^[a-z0-9]{12}$/i.test(g)) return null;
  history.replaceState(null, '', location.pathname + location.hash);
  return g.toLowerCase();
}

function error(e: { message: string } | null) {
  if (!e) return;
  if (/Failed to fetch|NetworkError|Load failed/i.test(e.message)) throw new Error('Sin conexión. Revisá internet y probá de nuevo.');
  throw new Error(e.message);
}

export interface DatosGrupo extends Datos {
  nombreGrupo: string;
}

export async function crearGrupo(nombre: string): Promise<string> {
  const { data, error: e } = await sb().rpc('crear_grupo', { p_nombre: nombre });
  error(e);
  return data as string;
}

export async function traerGrupo(codigo: string): Promise<DatosGrupo> {
  const { data, error: e } = await sb().rpc('grupo_datos', { p_codigo: codigo });
  error(e);
  const d = data as { nombre: string; avisoDias: number; amigos: string[]; juntadas: Juntada[] };
  return { ...validar({ version: 1, juntadas: d.juntadas, amigos: d.amigos, avisoDias: d.avisoDias }), nombreGrupo: d.nombre };
}

export async function guardarJuntadaNube(codigo: string, j: Juntada) {
  const { error: e } = await sb().rpc('guardar_juntada', { p_codigo: codigo, p: j });
  error(e);
}
export async function borrarJuntadaNube(codigo: string, id: string) {
  const { error: e } = await sb().rpc('borrar_juntada', { p_codigo: codigo, p_id: id });
  error(e);
}
export async function actualizarGrupo(codigo: string, cambios: { nombre?: string; avisoDias?: number; amigos?: string[] }) {
  const { error: e } = await sb().rpc('actualizar_grupo', {
    p_codigo: codigo, p_nombre: cambios.nombre ?? null, p_aviso_dias: cambios.avisoDias ?? null, p_amigos: cambios.amigos ?? null
  });
  error(e);
}

/** Sube a la nube todo lo que cambió entre dos versiones de los datos. */
export async function sincronizar(codigo: string, antes: Datos, despues: Datos) {
  const previas = new Map(antes.juntadas.map((j) => [j.id, JSON.stringify(j)]));
  const actuales = new Set(despues.juntadas.map((j) => j.id));
  for (const j of despues.juntadas) if (previas.get(j.id) !== JSON.stringify(j)) await guardarJuntadaNube(codigo, j);
  for (const j of antes.juntadas) if (!actuales.has(j.id)) await borrarJuntadaNube(codigo, j.id);
  const cambios: { avisoDias?: number; amigos?: string[] } = {};
  if (antes.avisoDias !== despues.avisoDias) cambios.avisoDias = despues.avisoDias;
  if (JSON.stringify(antes.amigos) !== JSON.stringify(despues.amigos)) cambios.amigos = despues.amigos;
  if (Object.keys(cambios).length) await actualizarGrupo(codigo, cambios);
}

// ------------------------------------------------------------- tiempo real
let canal: RealtimeChannel | null = null;
/** Escucha los cambios que hacen los demás (y avisa los propios). */
export function escucharGrupo(codigo: string, alCambiar: () => void): () => void {
  const ch = sb().channel(`grupo-${codigo}`, { config: { broadcast: { self: false } } });
  ch.on('broadcast', { event: 'cambio' }, () => alCambiar()).subscribe();
  canal = ch;
  return () => {
    if (canal === ch) canal = null;
    sb().removeChannel(ch);
  };
}
export function avisarCambio() {
  canal?.send({ type: 'broadcast', event: 'cambio', payload: {} }).catch(() => undefined);
}

// ------------------------------------------------------------- avisos push
export type EstadoAvisos = 'activos' | 'apagados' | 'bloqueados' | 'no-disponible' | 'iphone-instalar';

const esIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instalada = () => matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export async function estadoAvisos(): Promise<EstadoAvisos> {
  if (esIOS() && !instalada()) return 'iphone-instalar';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'no-disponible';
  if (Notification.permission === 'denied') return 'bloqueados';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'activos' : 'apagados';
}

function claveBytes(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function activarAvisos(codigo: string) {
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') throw new Error('No diste permiso para las notificaciones.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveBytes(VAPID_PUBLICA) }));
  const j = sub.toJSON();
  const { error: e } = await sb().rpc('suscribir_avisos', { p_codigo: codigo, p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth });
  error(e);
}

export async function desactivarAvisos() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await sb().rpc('cancelar_avisos', { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}
