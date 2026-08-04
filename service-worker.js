// =========================================================
// Unicon22 Cyclocross — Service Worker v9
// OFFLINE-FIRST: Echte 95%+ Offline-Fähigkeit
//
// Cache-Strategien:
//   Navigations-Requests (HTML):  Network-First → Cache → Offline-Fallback
//   App-Shell (JS/CSS/Icons/Libs): Cache-First
//   Karten-Tiles:                  Stale-While-Revalidate + Dedup (kein Flicker!)
//   Fonts (Bunny/Gstatic):         Stale-While-Revalidate (eigener Cache)
//   GPX-Tracks:                    Cache-First + Hintergrund-Update
//   Sonstiges:                     Network-First → Cache-Fallback
//
// v9 Verbesserungen gegenüber v8:
//   • Tile-Deduplication (_bgFetching): gleiche Tile wird NICHT mehrfach
//     gleichzeitig revalidiert → kein Browser-Hänger bei Pan/Zoom
//   • Batch-trimCache (TRIM_EVERY=50): cache.keys() nur alle 50 Inserts
//     statt bei jedem Tile-Insert → massive CPU-Ersparnis im SW
//   • PREFETCH_TILES mit Concurrency=6: Batch-Verarbeitung verhindert
//     Netzwerk-Überlastung, Cache-Check vor Fetch, _bgFetching-Dedup
// =========================================================

const SW_VERSION  = 'ccx-v1';
const SHELL_CACHE = SW_VERSION + '-shell';
const TILE_CACHE  = SW_VERSION + '-tiles';
const DATA_CACHE  = SW_VERSION + '-data';
const GPX_CACHE   = SW_VERSION + '-gpx';
const FONT_CACHE  = SW_VERSION + '-fonts';

const MAX_TILE_CACHE = 3000;
const MAX_GPX_CACHE  = 200;
const MAX_FONT_CACHE = 150;

// ── Tile-Deduplication & Trim-Rate-Limiting ───────────────────
// _bgFetching: verhindert, dass dieselbe Tile mehrfach gleichzeitig
//              im Hintergrund revalidiert wird (Leaflet kann dieselbe
//              Tile mehrfach anfordern).
// _tileInserts: trimCache erst alle TRIM_EVERY Inserts (spart cache.keys()-Aufrufe).
const _bgFetching  = new Set();
let   _tileInserts = 0;
const TRIM_EVERY   = 50; // trimCache alle N Einfügungen

// App-Shell: beim Install vorab cachen (alle für 100% Offline-Betrieb)
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  // App-Icons — alle Größen (korrekte Dateinamen icon-{w}x{h}.png)
  './icons/icon-16x16.png',
  './icons/icon-32x32.png',
  './icons/icon-48x48.png',
  './icons/icon-72x72.png',
  './icons/icon-96x96.png',
  './icons/icon-128x128.png',
  './icons/icon-144x144.png',
  './icons/icon-152x152.png',
  './icons/icon-180x180.png',
  './icons/icon-192x192.png',
  './icons/icon-256x256.png',
  './icons/icon-384x384.png',
  './icons/icon-512x512.png',
  // Leaflet (Karten-Engine — kritisch)
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  // Offline-Speicher (IndexedDB-Wrapper — kritisch)
  'https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js',
  // Geospatial-Berechnungen
  'https://cdn.jsdelivr.net/npm/@turf/turf@7.3.5/turf.min.js',
  // QR-Code-Scanner
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
  // Bunny Fonts CSS (DSGVO-konformes EU-Hosting)
  'https://fonts.bunny.net/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@400;500;600&display=swap',
];

// URL-Muster für Routing-Entscheidungen
const TILE_PATTERNS = [
  /opentopomap\.org/,
  /arcgisonline\.com/,
  /tile\.openstreetmap\.org/,
  /tile\.waymarkedtrails\.org/,
  /maps\.wikimedia\.org/,
];

const FONT_PATTERNS = [
  /fonts\.bunny\.net/,
  /fonts\.gstatic\.com/,
];

const GPX_PATTERNS = [
  /raw\.githubusercontent\.com.*\.gpx/i,
  /\.gpx(\?.*)?$/i,
];

// Transparentes 1x1 PNG als Tile-Platzhalter (Karte bricht nicht)
const TRANSPARENT_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  c => c.charCodeAt(0)
);

// Offline-Fallback-Seite
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0b0e14">
<title>Unicon22 Cyclocross - Offline</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0b0e14;color:#e0e6f0;
     display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.box{max-width:360px;width:100%;text-align:center}
.ico{font-size:72px;line-height:1;margin-bottom:16px}
h1{font-size:26px;font-weight:800;color:#f5a623;letter-spacing:.5px;text-transform:uppercase;margin-bottom:10px}
p{color:#8a9ab5;line-height:1.6;margin-bottom:8px;font-size:14px}
.tip{background:#161b25;border:1px solid #2a3349;border-radius:12px;padding:14px;
     font-size:12px;color:#6b7a99;line-height:1.9;margin-top:16px;text-align:left}
.tip strong{color:#f5a623}
button{background:#f5a623;color:#0b0e14;border:none;border-radius:12px;
       padding:14px 28px;font-size:13px;font-weight:800;cursor:pointer;
       margin-top:20px;letter-spacing:.5px;text-transform:uppercase;width:100%}
button:active{opacity:.8}
</style>
</head>
<body>
<div class="box">
  <div class="ico">🗺️</div>
  <h1>No internet</h1>
  <p>Unicon22 Cyclocross is not reachable right now.</p>
  <p>Open the app once while online so all map data gets stored on your device.</p>
  <p lang="de" style="font-size:12px">Kein Internet — öffne die App einmal online, damit die Karten-Daten lokal gespeichert werden.</p>
  <div class="tip">
    <strong>Tip for offline use:</strong><br>
    ① Open the app on Wi-Fi or mobile data<br>
    ② Zoom to the course area<br>
    ③ Tap Settings → App → cache map area<br>
    ④ After that the app works fully offline! 🎉
  </div>
  <button onclick="location.reload()">🔄 Try again</button>
</div>
</body>
</html>`;

// ==========================================================
// INSTALL: App-Shell vorab cachen
// ==========================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Install:', SW_VERSION);
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      // allSettled: ein Fehler bricht nicht den gesamten Install ab
      Promise.allSettled(
        SHELL_ASSETS.map(url =>
          cache.add(url).catch(err =>
            console.warn('[SW] Shell-Cache miss:', url, err.message)
          )
        )
      )
    ).then(() => {
      console.log('[SW] Shell gecacht, skipWaiting...');
      return self.skipWaiting();
    })
  );
});

// ==========================================================
// ACTIVATE: Alte Cache-Versionen bereinigen
// ==========================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate:', SW_VERSION);
  const validCaches = new Set([SHELL_CACHE, TILE_CACHE, DATA_CACHE, GPX_CACHE, FONT_CACHE]);

  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => !validCaches.has(k))
          .map(k => {
            console.log('[SW] Loesche alten Cache:', k);
            return caches.delete(k);
          })
      ))
      .then(() => {
        console.log('[SW] Aktiv, claim clients...');
        return self.clients.claim();
      })
  );
});

// ==========================================================
// FETCH: Request abfangen und Strategie anwenden
// ==========================================================
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = req.url;

  // Nur GET, nur HTTP(S)
  if (req.method !== 'GET') return;
  if (!url.startsWith('http')) return;

  // 1. Navigations-Requests: Shell-First mit Offline-Fallback
  if (req.mode === 'navigate') {
    event.respondWith(handleNavigation(req));
    return;
  }

  // 2. Karten-Tiles: Stale-While-Revalidate → kein Tile-Flicker im Offline-Modus
  if (TILE_PATTERNS.some(p => p.test(url))) {
    event.respondWith(staleWhileRevalidateTile(req));
    return;
  }

  // 3. Fonts: Stale-While-Revalidate (eigener Cache)
  if (FONT_PATTERNS.some(p => p.test(url))) {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE, MAX_FONT_CACHE));
    return;
  }

  // 4. GPX-Tracks: Cache-First + Hintergrund-Update
  if (GPX_PATTERNS.some(p => p.test(url))) {
    event.respondWith(cacheFirstWithNetworkFallback(req, GPX_CACHE, MAX_GPX_CACHE));
    return;
  }

  // 5. App-Shell (Bibliotheken, Icons, CSS): Cache-First
  if (isShellAsset(url)) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  // 6. Rest: Network-First mit Cache-Fallback
  event.respondWith(networkFirstGeneral(req));
});

// ==========================================================
// NAVIGATION: index.html aus Cache, Offline-Seite als Fallback
// ==========================================================
async function handleNavigation(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) {
      cache.put(req, fresh.clone());
      return fresh;
    }
    throw new Error('Bad status: ' + fresh.status);
  } catch (e) {
    // Offline: gecachte index.html zurueckgeben
    const cached = await cache.match('./index.html')
                || await cache.match('./')
                || await cache.match(req);
    if (cached) {
      console.log('[SW] Navigation offline -> gecachte index.html');
      return cached;
    }
    // Letzter Ausweg: statische Offline-Seite
    console.log('[SW] Navigation offline -> Offline-Fallback-Seite');
    return new Response(OFFLINE_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

// ==========================================================
// STRATEGIE: Cache-First (Shell-Assets)
// ==========================================================
async function cacheFirst(req, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;

  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    return new Response('Offline - Ressource nicht gecacht', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// ==========================================================
// STRATEGIE: Cache-First + Hintergrund-Update (GPX)
// ==========================================================
async function cacheFirstWithNetworkFallback(req, cacheName, maxEntries) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(req);

  if (cached) {
    // Hintergrund-Aktualisierung (nicht blockierend)
    fetch(req).then(fresh => {
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
    }).catch(e => console.warn('SW bg-revalidate:', e.message || e));
    return cached;
  }

  try {
    const fresh = await fetch(req);
    if (fresh.ok) {
      cache.put(req, fresh.clone());
      if (maxEntries) trimCache(cacheName, maxEntries);
    }
    return fresh;
  } catch (e) {
    return new Response('GPX offline nicht verfuegbar', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// ==========================================================
// STRATEGIE: Stale-While-Revalidate für Karten-Tiles
//
// Verbesserungen gegenüber naiver SWR-Implementierung:
//   • Deduplication (_bgFetching): gleiche Tile wird NICHT mehrfach
//     gleichzeitig im Hintergrund gefetcht — vermeidet Browser-Hänger
//     bei Zoom/Pan, wenn Leaflet dieselbe Tile mehrfach anfordert.
//   • Batch-Trim: trimCache nur alle TRIM_EVERY Einfügungen, nicht
//     auf jeden Tile-Insert (spart cache.keys()-Roundtrips im SW).
//   • Sofortige Antwort bei Cache-Hit — kein Warten auf Netzwerk.
// ==========================================================
async function staleWhileRevalidateTile(req) {
  const cache  = await caches.open(TILE_CACHE);
  const cached = await cache.match(req);

  if (cached) {
    // Cache-Hit: sofort liefern, dann im Hintergrund aktualisieren
    // — aber NUR wenn für diese URL noch kein Hintergrund-Fetch läuft
    if (!_bgFetching.has(req.url)) {
      _bgFetching.add(req.url);
      fetch(req, { cache: 'no-store' })
        .then(res => {
          if (res?.ok) {
            cache.put(req, res.clone());
            if (++_tileInserts % TRIM_EVERY === 0) trimCache(TILE_CACHE, MAX_TILE_CACHE);
          }
        })
        .catch(e => console.warn('SW tile-prefetch:', e.message || e))
        .finally(() => _bgFetching.delete(req.url));
    }
    return cached;
  }

  // Cache-Miss: Netzwerk abwarten (erste Anfrage für diese Tile)
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res?.ok) {
      await cache.put(req, res.clone());
      if (++_tileInserts % TRIM_EVERY === 0) trimCache(TILE_CACHE, MAX_TILE_CACHE);
    }
    return res;
  } catch {
    // Offline und kein Cache-Eintrag → transparentes 1×1 PNG (Karte bricht nicht)
    return new Response(TRANSPARENT_PNG, {
      status: 200,
      headers: { 'Content-Type': 'image/png' }
    });
  }
}

// ==========================================================
// STRATEGIE: Stale-While-Revalidate (Fonts)
// ==========================================================
async function staleWhileRevalidate(req, cacheName, maxEntries) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req)
    .then(fresh => {
      if (fresh && fresh.ok) {
        cache.put(req, fresh.clone());
        if (maxEntries) trimCache(cacheName, maxEntries);
      }
      return fresh;
    })
    .catch(e => { console.warn('SW font-revalidate:', e.message || e); return null; });

  return cached || fetchPromise;
}

// ==========================================================
// STRATEGIE: Network-First allgemein
// ==========================================================
async function networkFirstGeneral(req) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    const cached = await cache.match(req);
    return cached || new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// ==========================================================
// HILFSFUNKTION: Cache-Groesse begrenzen (FIFO-Rotation)
// ==========================================================
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys  = await cache.keys();

  if (keys.length > maxEntries) {
    const toDelete = keys.slice(0, keys.length - maxEntries);
    await Promise.all(toDelete.map(k => cache.delete(k)));
    console.log('[SW] Rotation:', cacheName, '-', toDelete.length, 'entfernt,', maxEntries, 'behalten');
  }
}

// ==========================================================
// HILFSFUNKTION: Shell-Asset erkennen
// ==========================================================
function isShellAsset(url) {
  return SHELL_ASSETS.some(asset => {
    if (!asset.startsWith('http')) {
      return url.includes(asset.replace('./', ''));
    }
    return url.startsWith(asset.split('?')[0]);
  });
}

// ==========================================================
// MESSAGE HANDLER: Kommunikation mit der App
// ==========================================================
self.addEventListener('message', (event) => {
  if (!event.data) return;

  switch (event.data.type) {

    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'CLEAR_TILE_CACHE':
      caches.delete(TILE_CACHE).then(() => {
        console.log('[SW] Tile-Cache manuell geleert');
        event.ports[0]?.postMessage({ success: true });
      });
      break;

    // GPX-Tracks aggressiv vorab cachen
    case 'PREFETCH_GPX':
      if (Array.isArray(event.data.urls)) {
        caches.open(GPX_CACHE).then(cache => {
          const fetches = event.data.urls.map(url =>
            cache.match(url).then(cached => {
              if (cached) return;
              return fetch(url)
                .then(r => { if (r && r.ok) cache.put(url, r); })
                .catch(err => console.warn('[SW] GPX prefetch miss:', url, err.message));
            })
          );
          return Promise.allSettled(fetches);
        }).then(() => {
          event.ports[0]?.postMessage({ success: true, count: event.data.urls.length });
        });
      }
      break;

    // Karten-Tiles für eine Region vorab cachen (concurrent batches)
    // Verbesserungen:
    //   • Batch-Concurrency (6): nie mehr als 6 Fetches gleichzeitig
    //     → Browser-Netzwerkstack nicht überschwemmen
    //   • Dedup: URLs die gerade revalidiert werden (_bgFetching) überspringen
    //   • Cache-Check vor Fetch: bereits gecachte Tiles sofort überspringen
    case 'PREFETCH_TILES':
      if (Array.isArray(event.data.urls) && event.data.urls.length > 0) {
        const CONCURRENCY = 6;
        event.waitUntil((async () => {
          const cache = await caches.open(TILE_CACHE);
          const urls  = event.data.urls;
          let fetched = 0, already = 0, failed = 0;

          for (let i = 0; i < urls.length; i += CONCURRENCY) {
            const batch = urls.slice(i, i + CONCURRENCY);
            await Promise.allSettled(batch.map(async url => {
              // Überspringe URLs die gerade live revalidiert werden
              if (_bgFetching.has(url)) { already++; return; }
              // Überspringe bereits gecachte Tiles
              if (await cache.match(url)) { already++; return; }
              _bgFetching.add(url);
              try {
                const r = await fetch(url, { cache: 'no-store' });
                if (r?.ok) { await cache.put(url, r.clone()); fetched++; }
                else failed++;
              } catch { failed++; }
              finally { _bgFetching.delete(url); }
            }));
          }

          if (fetched > 0) {
            _tileInserts += fetched;
            await trimCache(TILE_CACHE, MAX_TILE_CACHE);
          }
          console.log(`[SW] Tile-Prefetch: ${fetched} neu, ${already} gecacht, ${failed} Fehler`);
          event.ports[0]?.postMessage({ success: true, fetched, already, failed });
        })());
      }
      break;

    // Cache-Statistik an App senden
    case 'GET_CACHE_SIZE':
      Promise.all([
        caches.open(TILE_CACHE).then(c  => c.keys()),
        caches.open(SHELL_CACHE).then(c => c.keys()),
        caches.open(DATA_CACHE).then(c  => c.keys()),
        caches.open(GPX_CACHE).then(c   => c.keys()),
        caches.open(FONT_CACHE).then(c  => c.keys()),
      ]).then(([tiles, shell, data, gpx, fonts]) => {
        event.ports[0]?.postMessage({
          tileCount:  tiles.length,
          shellCount: shell.length,
          dataCount:  data.length,
          gpxCount:   gpx.length,
          fontCount:  fonts.length,
          total:      tiles.length + shell.length + data.length + gpx.length + fonts.length,
        });
      });
      break;

    // Alle Caches leeren (Factory-Reset)
    case 'CLEAR_ALL_CACHES':
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
        .then(() => {
          console.log('[SW] Alle Caches geleert');
          event.ports[0]?.postMessage({ success: true });
        });
      break;
  }
});
