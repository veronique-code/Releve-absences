const CACHE_NAME = 'espace-direction-v8';
const ASSETS = [
  './index.html',
  './cahier-appel.html',
  './sorties.html',
  './demandes.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS.map(url =>
        cache.add(url).catch(err => console.warn('Échec de mise en cache :', url, err))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;

  // On ignore ce qui n'est pas une simple lecture de page ou de fichier du site.
  if (req.method !== 'GET') return;
  if (!req.url.startsWith('http')) return;
  if (new URL(req.url).origin !== self.location.origin) return;

  const estUnePage = req.mode === 'navigate' || req.destination === 'document' ||
                     req.url.endsWith('.html') || req.url.endsWith('/');

  if (estUnePage) {
    // Pages : on va chercher la version en ligne d'abord, le cache ne sert
    // que si le réseau est indisponible. La dernière version est donc
    // toujours affichée, sans rechargement forcé.
    event.respondWith(
      fetch(req)
        .then(res => {
          const copie = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copie));
          return res;
        })
        .catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // Autres fichiers (icônes, manifeste) : cache d'abord, mise à jour discrète.
  event.respondWith(
    caches.match(req).then(cached => {
      const reseau = fetch(req).then(res => {
        const copie = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copie));
        return res;
      }).catch(() => cached);
      return cached || reseau;
    })
  );
});
