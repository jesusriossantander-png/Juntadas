/**
 * Web Push: suscripción voluntaria, con clave VAPID pública.
 * Limitaciones reales:
 *  - Android (Chrome/Edge/Firefox/Samsung): funciona en navegador y app instalada.
 *  - iPhone/iPad: solo desde iOS/iPadOS 16.4+ y con la app AGREGADA A INICIO (PWA instalada).
 *  - Si la persona bloquea el permiso, hay que reactivarlo desde los ajustes del navegador.
 */
import type { Backend } from '../data/backend';

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushSupport = 'ok' | 'unsupported' | 'ios-needs-install' | 'no-server' | 'denied';

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}
export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function pushSupport(backend: Backend): PushSupport {
  if (isIOS() && !isStandalone()) return 'ios-needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (!VAPID || backend.mode === 'demo') return 'no-server';
  return 'ok';
}

function b64ToUint8(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush(backend: Backend): Promise<void> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('No diste permiso para notificaciones.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(VAPID!) });
  await backend.savePushSubscription(sub.toJSON());
}

export async function disablePush(backend: Backend): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await backend.deletePushSubscription(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}
