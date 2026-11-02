/// <reference lib="webworker" />
// Service worker: guarda la app en el celular para que abra sin internet.
// También recibe los avisos del grupo (Web Push).
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

self.addEventListener('push', (event) => {
  let d: { title?: string; body?: string; tag?: string } = {};
  try { d = event.data?.json() ?? {}; } catch { d = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || 'La Juntada', {
    body: d.body || '', tag: d.tag, icon: 'icons/icon-192.png', badge: 'icons/badge-72.png'
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of abiertas) if ('focus' in c) return (c as WindowClient).focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});
