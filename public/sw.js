/* Service worker: jogo offline após o primeiro carregamento. */
const CACHE = 'mercadinho-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

// Pré-carrega o shell E os arquivos com hash referenciados pelo index.html:
// na 1ª visita eles foram baixados antes do SW assumir, então não estariam no cache.
async function precache() {
  const c = await caches.open(CACHE);
  await c.addAll(SHELL);
  const html = await (await c.match('./index.html')).text();
  const assets = [...html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+)"/g)].map((m) => './' + m[1].replace(/^\.?\//, ''));
  await c.addAll([...new Set(assets)]);
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Navegação: rede primeiro (pega versão nova), cai para o cache offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return r; }).catch(() => caches.match('./index.html', { ignoreVary: true })));
    return;
  }
  // Demais arquivos (assets com hash): cache primeiro, atualiza em segundo plano.
  e.respondWith(
    caches.match(req, { ignoreVary: true }).then((hit) => {
      const net = fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return r; }).catch(() => hit);
      return hit || net;
    }),
  );
});
