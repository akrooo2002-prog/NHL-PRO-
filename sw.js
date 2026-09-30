/* NHL Pronos — service worker
   Objectif : l'app s'ouvre instantanément et reste lisible hors ligne.
   · l'interface vient du cache, puis est rafraîchie en arrière-plan ;
   · les données tentent le réseau d'abord, et retombent sur le cache sinon.
   Les photos de joueurs viennent d'assets.nhle.com : hors ligne elles
   manquent, l'app affiche les initiales à la place. */
// Version remplacée à chaque dépôt par GitHub Actions (date du build) :
// le cache change donc de nom à chaque mise à jour, l'ancien est purgé.
const VERSION = "__SW_VERSION__";
const COQUILLE = ["/", "/app.html", "/manifest.webmanifest",
                  "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION)
    .then(c => Promise.all(COQUILLE.map(u => c.add(u).catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // photos NHL : cache d'abord, on ne bloque jamais l'affichage
  if (url.hostname !== self.location.hostname) {
    e.respondWith(caches.match(req).then(c => c || fetch(req).then(r => {
      const copie = r.clone();
      caches.open(VERSION).then(c => c.put(req, copie)).catch(() => {});
      return r;
    }).catch(() => caches.match("/icons/icon-192.png"))));
    return;
  }

  // interface : réseau d'abord, cache en secours — toujours la dernière
  // version en ligne ; hors ligne, le cache prend le relais.
  if (req.mode === "navigate" || COQUILLE.includes(url.pathname)) {
    e.respondWith(fetch(req).then(r => {
      if (r && r.ok) {
        const copie = r.clone();
        caches.open(VERSION).then(c => c.put(req, copie)).catch(() => {});
      }
      return r;
    }).catch(() => caches.match(req).then(c => c || caches.match("/app.html"))));
    return;
  }

  // données : réseau d'abord, cache en secours (elles changent à chaque dépôt)
  e.respondWith(fetch(req).then(r => {
    if (r && r.ok) caches.open(VERSION).then(c => c.put(req, r.clone())).catch(() => {});
    return r;
  }).catch(() => caches.match(req).then(c => c || caches.match("/app.html"))));
});
