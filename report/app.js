'use strict';

const CENTER = [135.207, 35.250];
const DEMO_MODE = ['127.0.0.1', 'localhost'].includes(location.hostname)
  && new URLSearchParams(location.search).get('demo') === '1';
const DEMO_DATA = {
  notes: [
    {
      id: 'demo-note-1', title: '地域を歩いて見つけた風景', category: 'メモ',
      text: '地域の方にお話を伺いながら、これから残していきたい場所を記録しました。',
      lat: 35.25266, lng: 135.21102, date: '2026-08-29', photos: [], source: '地域おこし協力隊',
    },
    {
      id: 'demo-note-2', title: '星空観察会を開催しました', category: 'メモ',
      text: '参加者のみなさんと、上六人部の夜空をゆっくり観察しました。',
      lat: 35.2458, lng: 135.218, date: '2026-08-08', photos: [], source: '',
    },
  ],
  spots: [
    {
      id: 'demo-spot-1', title: '地域の立ち寄りスポット', category: 'お店',
      text: '地域でひと休みできる場所です。', lat: 35.247, lng: 135.207, photos: [], source: '',
    },
    {
      id: 'demo-spot-2', title: '歴史を感じる神社', category: '寺社仏閣',
      text: '地域の歴史を今に伝える場所です。', lat: 35.251, lng: 135.219, photos: [], source: '',
    },
    {
      id: 'demo-spot-3', title: '上六人部の自然', category: '自然スポット',
      text: '季節ごとに表情が変わる自然の風景です。', lat: 35.255, lng: 135.226, photos: [], source: '',
    },
  ],
  meta: { generatedAt: '2026-08-29T12:00:00.000Z' },
};
const state = {
  notes: [],
  spots: [],
  activeKind: 'notes',
  category: null,
  markers: [],
  loadedAt: null,
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function photoUrl(name) {
  return `../public-data/photos/${encodeURIComponent(name)}`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

function formatUpdatedAt(value) {
  if (!value) return '更新日時を取得できませんでした';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '更新日時を取得できませんでした';
  return `${new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)} 更新`;
}

async function fetchJson(path) {
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(`${path}${separator}t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

const map = new maplibregl.Map({
  container: 'map',
  center: CENTER,
  zoom: 13.2,
  pitch: 48,
  bearing: -18,
  maxPitch: 68,
  attributionControl: { compact: true },
  style: {
    version: 8,
    sources: {
      photo: {
        type: 'raster',
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'],
        tileSize: 256,
        maxzoom: 18,
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
      },
      dem: {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        tileSize: 256,
        encoding: 'terrarium',
        maxzoom: 14,
        attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">Mapzen/AWS</a>',
      },
      area: { type: 'geojson', data: '../area.geojson' },
    },
    layers: [
      { id: 'photo', type: 'raster', source: 'photo' },
      {
        id: 'area-fill', type: 'fill', source: 'area',
        filter: ['==', ['get', 'kind'], 'aza'],
        paint: { 'fill-color': '#52b788', 'fill-opacity': 0.08 },
      },
      {
        id: 'area-line', type: 'line', source: 'area',
        filter: ['==', ['get', 'kind'], 'aza'],
        paint: { 'line-color': '#f8f9fa', 'line-width': 1.5, 'line-dasharray': [2, 2] },
      },
      {
        id: 'boundary-line', type: 'line', source: 'area',
        filter: ['==', ['get', 'kind'], 'boundary'],
        paint: { 'line-color': '#ffd43b', 'line-width': 3 },
      },
    ],
    terrain: { source: 'dem', exaggeration: 1.15 },
  },
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));
map.addControl(new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: false,
  showUserLocation: true,
}));

function visibleItems() {
  const items = state[state.activeKind].filter((item) => !item.archivedAt);
  return items.filter((item) => {
    if (!state.category) return true;
    return kmapPinTypes.typeIdFor(state.activeKind, item.category) === state.category;
  });
}

function clearMarkers() {
  state.markers.forEach((marker) => marker.remove());
  state.markers = [];
}

function renderMarkers() {
  clearMarkers();
  for (const kind of ['spots', 'notes']) {
    for (const item of state[kind]) {
      if (item.archivedAt || !Number.isFinite(item.lat) || !Number.isFinite(item.lng)) continue;
      const type = kmapPinTypes.typeFor(kind, item.category);
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `report-marker report-marker-${type.id}`;
      element.title = item.title;
      element.setAttribute('aria-label', `${type.label}: ${item.title}`);
      element.onclick = (event) => {
        event.stopPropagation();
        openDetail(kind, item);
      };
      const marker = new maplibregl.Marker({
        element,
        anchor: 'bottom',
        subpixelPositioning: true,
      }).setLngLat([item.lng, item.lat]).addTo(map);
      state.markers.push(marker);
    }
  }
}

function renderSummary() {
  document.getElementById('notes-count').textContent = state.notes.length;
  document.getElementById('spots-count').textContent = state.spots.length;
  document.getElementById('total-count').textContent = state.notes.length + state.spots.length;
}

function renderFilters() {
  const wrap = document.getElementById('filter-chips');
  wrap.innerHTML = '';
  const options = [{ id: null, icon: '', label: 'すべて' }, ...kmapPinTypes.formCategories(state.activeKind)];
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chip ${state.category === option.id ? 'active' : ''}`;
    button.textContent = `${option.icon || ''}${option.icon ? ' ' : ''}${option.label}`;
    button.onclick = () => {
      state.category = option.id;
      renderFilters();
      renderCards();
    };
    wrap.appendChild(button);
  }
}

function cardHtml(kind, item) {
  const type = kmapPinTypes.typeFor(kind, item.category);
  const photo = item.photos?.[0];
  const meta = kind === 'notes' ? formatDate(item.date) : type.label;
  return `
    ${photo ? `<img class="card-photo" src="${photoUrl(photo)}" alt="${esc(item.title)}の写真" loading="lazy">` : ''}
    <div class="card-body">
      <div class="card-meta"><span>${type.icon}</span><span>${esc(meta)}</span></div>
      <h2 class="card-title">${esc(item.title)}</h2>
      ${item.text ? `<p class="card-text">${esc(item.text)}</p>` : ''}
    </div>`;
}

function renderCards() {
  const wrap = document.getElementById('cards');
  wrap.innerHTML = '';
  const items = visibleItems();
  if (!items.length) {
    wrap.innerHTML = '<div class="empty-state">現在公開されている記録はありません。<br>公開準備ができ次第、こちらに追加されます。</div>';
    return;
  }

  for (const item of items) {
    const card = document.createElement('article');
    card.className = `record-card ${item.photos?.length ? '' : 'no-photo'}`;
    card.tabIndex = 0;
    card.innerHTML = cardHtml(state.activeKind, item);
    const show = () => {
      map.flyTo({ center: [item.lng, item.lat], zoom: 15.2, pitch: 52, essential: true });
      openDetail(state.activeKind, item);
    };
    card.onclick = show;
    card.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        show();
      }
    };
    wrap.appendChild(card);
  }
}

const detailBackdrop = document.getElementById('detail-backdrop');

function openDetail(kind, item) {
  const type = kmapPinTypes.typeFor(kind, item.category);
  const photos = item.photos?.length
    ? `<div class="detail-photos">${item.photos.map((name) => `<img src="${photoUrl(name)}" alt="${esc(item.title)}の写真" loading="lazy">`).join('')}</div>`
    : '';
  document.getElementById('detail-content').innerHTML = `
    ${photos}
    <div class="detail-category">${type.icon} ${esc(type.label)}</div>
    <h2 id="detail-title">${esc(item.title)}</h2>
    ${kind === 'notes' && item.date ? `<p class="detail-date">📅 ${esc(formatDate(item.date))}</p>` : ''}
    ${item.text ? `<p class="detail-text">${esc(item.text)}</p>` : ''}
    ${item.source ? `<p class="detail-source">出典・提供：${esc(item.source)}</p>` : ''}`;
  detailBackdrop.classList.remove('hidden');
}

function closeDetail() {
  detailBackdrop.classList.add('hidden');
}

document.getElementById('detail-close').onclick = closeDetail;
detailBackdrop.onclick = (event) => { if (event.target === detailBackdrop) closeDetail(); };
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetail(); });

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((other) => other.classList.remove('active'));
    tab.classList.add('active');
    state.activeKind = tab.dataset.kind;
    state.category = null;
    renderFilters();
    renderCards();
  };
});

async function loadAll() {
  const status = document.getElementById('update-status');
  status.textContent = '最新情報を確認しています…';
  status.classList.remove('error');
  try {
    const [notes, spots, meta] = DEMO_MODE
      ? [DEMO_DATA.notes, DEMO_DATA.spots, DEMO_DATA.meta]
      : await Promise.all([
        fetchJson('../public-data/notes.json'),
        fetchJson('../public-data/spots.json'),
        fetchJson('../public-data/meta.json'),
      ]);
    state.notes = [...notes].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    state.spots = [...spots];
    state.loadedAt = new Date();
    status.textContent = DEMO_MODE
      ? '表示確認用のデモデータです'
      : `最終更新：${formatUpdatedAt(meta.generatedAt)}`;
    renderSummary();
    renderFilters();
    renderCards();
    renderMarkers();
  } catch (error) {
    status.textContent = '最新情報を読み込めませんでした。通信状況を確認して更新してください。';
    status.classList.add('error');
    document.getElementById('cards').innerHTML = `<div class="error-state">データを読み込めませんでした。<br>${esc(error.message)}</div>`;
  }
}

document.getElementById('refresh-button').onclick = loadAll;
document.getElementById('share-button').onclick = async () => {
  const shareData = { title: document.title, text: '上六人部の活動記録をご覧ください。', url: location.href };
  if (navigator.share) {
    try { await navigator.share(shareData); } catch { /* キャンセルは何もしない */ }
  } else {
    await navigator.clipboard.writeText(location.href);
    const button = document.getElementById('share-button');
    button.textContent = 'コピー済み';
    setTimeout(() => { button.textContent = '共有'; }, 1600);
  }
};

map.on('load', loadAll);
new ResizeObserver(() => map.resize()).observe(document.getElementById('map'));

setInterval(() => {
  if (!document.hidden && state.loadedAt && Date.now() - state.loadedAt.getTime() >= 60_000) loadAll();
}, 60_000);

window._kmapReport = { map, state, loadAll, openDetail };
