/* service worker mínimo: passthrough de red (necesario para que Android ofrezca instalar).
   Sin caché: la app es dinámica y con auth — no queremos servir nada rancio. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  e.respondWith(fetch(e.request));
});
