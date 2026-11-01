/// <reference lib="webworker" />
// Service Worker de La Juntada:
//  - Precarga de archivos estáticos (la app abre sin conexión).
//  - Actualización controlada: la nueva versión se activa cuando la persona acepta.
//  - Recepción de notificaciones Web Push.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

interface PushPayload {
  title?: string;
  body?: string;
  link?: string;
  tag?: string;
}

self.addEventListener('push', (event) => {
  let data: PushPayload = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: 'La Juntada', body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'La Juntada', {
      body: data.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-72.png',
      tag: data.tag, // mismo tag = reemplaza en vez de duplicar
      data: { link: data.link || '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link: string = event.notification.data?.link || '/';
  const url = new URL(self.registration.scope);
  url.hash = link.startsWith('/') ? link : `/${link}`;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if ('focus' in c) {
          await (c as WindowClient).navigate(url.href).catch(() => undefined);
          return (c as WindowClient).focus();
        }
      }
      return self.clients.openWindow(url.href);
    })()
  );
});
