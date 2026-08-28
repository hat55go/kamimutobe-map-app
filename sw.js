// アプリ本体をキャッシュして、圏外・機内モードでも起動できるようにする。
// 記録データは localStorage 側のキャッシュを app.js が使うので、ここでは扱わない。
const CACHE = 'kamimutobe-map-v8';
const ASSETS = [
  './',
  './index.html',
  './style.css?v=8',
  './app.js?v=8',
  './storage.js?v=8',
  './record-merge.js?v=8',
  './pin-types.js?v=8',
  './image-utils.js?v=8',
  './vendor/heic2any.min.js',
  './area.geojson',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // 1 つでも失敗すると全部入らないので個別に入れる
      .then((c) => Promise.allSettled(ASSETS.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // GitHub API（記録の読み書き）は必ずネットワークへ。古い内容を返してはいけない
  if (url.hostname === 'api.github.com') return;

  // 地図タイルはブラウザ標準のキャッシュに任せる（量が多くストレージを圧迫するため）
  if (url.hostname.includes('cyberjapandata.gsi.go.jp')
      || url.hostname.includes('disaportaldata.gsi.go.jp')
      || url.hostname.includes('amazonaws.com')) return;

  // アプリ本体はネットワーク優先。更新を即時反映しつつ、圏外時だけキャッシュへ戻す。
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
        return res;
      })
      .catch(() => caches.match(request)),
  );
});
