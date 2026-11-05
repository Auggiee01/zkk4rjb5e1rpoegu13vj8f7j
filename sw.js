// Vault offline cache (version 02300fa645bd). The app works with no internet once installed.
const CACHE = 'vault-02300fa645bd';
const FILES = ["assets/apple-touch-icon.png", "assets/icon-192.png", "assets/icon-512.png", "assets/icon.png", "assets/tray.png", "assets/tray@2x.png", "index.html", "manifest.webmanifest", "renderer/app.mjs", "renderer/icons.mjs", "renderer/importers.mjs", "renderer/store.mjs", "renderer/styles.css", "renderer/tidy.mjs", "renderer/ui.mjs", "renderer/view-auth.mjs", "renderer/view-generator.mjs", "renderer/view-health.mjs", "renderer/view-settings.mjs", "renderer/view-vault.mjs", "shared/domains.mjs", "shared/eff_large_wordlist.txt", "shared/generator.mjs", "shared/scrypt.mjs", "shared/sync.mjs", "shared/totp.mjs", "shared/webvault.mjs", "vendor/jsQR.js", "vendor/qrcodegen.js", "web/index.html", "web/kh-web.mjs"];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
