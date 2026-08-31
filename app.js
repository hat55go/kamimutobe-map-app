'use strict';

// ---- 定数 ----
const CENTER = [135.207, 35.250]; // 上六人部（土師川中流域）の中心付近
const KIND_LABEL = { notes: 'メモ', spots: '場所' };
const DEMO_MODE = ['localhost', '127.0.0.1'].includes(location.hostname)
  && new URLSearchParams(location.search).has('demo');
const DEMO_DATA = {
  notes: [
    { id: 'demo-note', title: '川沿いの観察メモ', category: '気づき', date: '2026-08-28', text: '現地で気づいたことを記録', lat: 35.252, lng: 135.205 },
  ],
  spots: [
    { id: 'demo-shop', title: '地域のお店', category: 'お店', text: 'お店の記録例', lat: 35.254, lng: 135.212 },
    { id: 'demo-facility', title: '地域交流館', category: '施設', text: '公共施設の記録例', lat: 35.250, lng: 135.208 },
    { id: 'demo-shrine', title: '地域の神社', category: '神社仏閣', text: '寺社仏閣の記録例', lat: 35.251, lng: 135.214 },
    { id: 'demo-nature', title: '自然観察スポット', category: '自然', text: '自然スポットの記録例', lat: 35.248, lng: 135.202 },
    { id: 'demo-hidden', title: '非表示のテストピン', category: 'その他', text: '復元確認用', lat: 35.251, lng: 135.210, archivedAt: '2026-08-28T00:00:00.000Z' },
  ],
};

// ---- 状態 ----
const state = {
  notes: [],
  spots: [],
  activeTab: 'notes',
  query: '',
  categoryFilter: null, // null = すべて
  markers: [],          // 表示中の maplibregl.Marker
};

// ---- ユーティリティ ----
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function today() {
  return new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD（ローカル時刻）
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// private リポジトリの画像は URL 直指定で開けないので、取得後に src を差し込む
function resolvePhotos(root) {
  root.querySelectorAll('img[data-photo]').forEach(async (img) => {
    const name = img.dataset.photo;
    try {
      img.src = await kmapStorage.photoUrl(name);
    } catch {
      img.alt = '写真を読み込めません';
      img.classList.add('photo-missing');
    }
  });
}

// 旧サーバ API と同じ呼び出し方のまま、中身を GitHub への読み書きに差し替えている。
// 書き込みは毎回リポジトリの最新を読んでから更新するので、他端末の変更を踏み潰さない。
async function api(path, method = 'GET', body, baseItem = null) {
  const { kind, id } = kmapRecordMerge.parseApiPath(path);
  const label = kind === 'notes' ? '記録' : '場所';

  if (method === 'GET') {
    const { items, fromCache } = await kmapStorage.loadCollection(kind);
    setOfflineBanner(fromCache);
    return items;
  }

  const { items, fromCache } = await kmapStorage.loadCollection(kind);
  if (fromCache) throw new Error('オフラインのため保存できません（電波が戻ってからもう一度）');

  if (method === 'POST') {
    const itemId = body.id || genId();
    const alreadySaved = items.find((it) => it.id === itemId);
    if (alreadySaved) return alreadySaved; // 応答だけ途切れた後の再保存でも重複させない
    const item = { ...body, id: itemId, createdAt: new Date().toISOString() };
    items.push(item);
    await kmapStorage.saveCollection(kind, items, `${kind}: add ${item.title}`);
    return item;
  }

  const index = items.findIndex((it) => it.id === id);
  if (index === -1) throw new Error(`${label}が見つかりません`);

  if (method === 'PUT') {
    const merged = kmapRecordMerge.mergeItem(baseItem, items[index], body);
    items[index] = merged;
    await kmapStorage.saveCollection(kind, items, `${kind}: update ${merged.title}`);
    return merged;
  }

  if (method === 'DELETE') {
    const archived = kmapRecordMerge.archiveItem(baseItem, items[index]);
    items[index] = archived;
    await kmapStorage.saveCollection(kind, items, `${kind}: archive ${archived.title}`);
    return archived;
  }

  if (method === 'RESTORE') {
    const restored = kmapRecordMerge.restoreItem(baseItem, items[index]);
    items[index] = restored;
    await kmapStorage.saveCollection(kind, items, `${kind}: restore ${restored.title}`);
    return restored;
  }

  throw new Error(`未対応の操作: ${method}`);
}

function setOfflineBanner(offline) {
  const el = document.getElementById('offline-banner');
  if (!el) return;
  el.classList.toggle('hidden', !offline);
  if (offline) {
    const at = kmapStorage.cacheSavedAt();
    el.textContent = `📴 オフライン表示中${at ? `（${new Date(at).toLocaleString('ja-JP')}時点）` : ''}・保存はできません`;
  }
}

// ---- 地図 ----
const map = new maplibregl.Map({
  container: 'map',
  center: CENTER,
  zoom: 13.2,
  pitch: 60,
  bearing: -20,
  maxPitch: 75,
  hash: true,
  attributionControl: { compact: false },
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
      std: {
        type: 'raster',
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 18,
      },
      dem: {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        tileSize: 256,
        encoding: 'terrarium',
        maxzoom: 14,
        attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">Mapzen/AWS</a>',
      },
      hazardFlood: {
        type: 'raster',
        tiles: ['https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png'],
        tileSize: 256,
        minzoom: 2,
        maxzoom: 17,
        attribution: '<a href="https://disaportal.gsi.go.jp/" target="_blank">ハザードマップポータルサイト</a>',
      },
      hazardDebris: {
        type: 'raster',
        tiles: ['https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png'],
        tileSize: 256,
        minzoom: 2,
        maxzoom: 17,
        attribution: '<a href="https://disaportal.gsi.go.jp/" target="_blank">ハザードマップポータルサイト</a>',
      },
      hazardSteep: {
        type: 'raster',
        tiles: ['https://disaportaldata.gsi.go.jp/raster/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png'],
        tileSize: 256,
        minzoom: 2,
        maxzoom: 17,
        attribution: '<a href="https://disaportal.gsi.go.jp/" target="_blank">ハザードマップポータルサイト</a>',
      },
      hazardLandslide: {
        type: 'raster',
        tiles: ['https://disaportaldata.gsi.go.jp/raster/05_jisuberikeikaikuiki/{z}/{x}/{y}.png'],
        tileSize: 256,
        minzoom: 2,
        maxzoom: 17,
        attribution: '<a href="https://disaportal.gsi.go.jp/" target="_blank">ハザードマップポータルサイト</a>',
      },
    },
    layers: [
      { id: 'photo', type: 'raster', source: 'photo' },
      { id: 'std', type: 'raster', source: 'std', layout: { visibility: 'none' } },
      // aerial photos already contain natural shading — hillshade is only for the plain map
      { id: 'hills', type: 'hillshade', source: 'dem', layout: { visibility: 'none' }, paint: { 'hillshade-exaggeration': 0.25 } },
      { id: 'hazard-flood', type: 'raster', source: 'hazardFlood', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.68 } },
      { id: 'hazard-debris', type: 'raster', source: 'hazardDebris', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.72 } },
      { id: 'hazard-steep', type: 'raster', source: 'hazardSteep', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.72 } },
      { id: 'hazard-landslide', type: 'raster', source: 'hazardLandslide', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.72 } },
    ],
    terrain: { source: 'dem', exaggeration: 1.3 },
    sky: {
      'sky-color': '#a8c8e8',
      'horizon-color': '#f4efe6',
      'fog-color': '#efe9dd',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.7,
    },
  },
});

// ---- 区域レイヤー（上六人部の外周 + 9大字の範囲・ラベル） ----
const AZA_COLORS = ['#4dabf7', '#38d9a9', '#ffd43b', '#ff8787', '#b197fc', '#63e6be', '#ffa94d', '#74c0fc', '#f783ac'];
const areaLabels = [];
let areaVisible = true;

// style.load で追加する（'load' は全タイル取得後なので遅い回線だと境界が出るのが遅れる）
map.on('style.load', async () => {
  map.addSource('area', {
    type: 'geojson',
    data: 'area.geojson',
    attribution: '境界: <a href="https://www.e-stat.go.jp/" target="_blank">e-Stat 国勢調査2020小地域</a>',
  });

  const area = await (await fetch('area.geojson')).json();
  const azaFeatures = area.features.filter((f) => f.properties.kind === 'aza');
  const fillColor = ['match', ['get', 'name'],
    ...azaFeatures.flatMap((f, i) => [f.properties.name, AZA_COLORS[i % AZA_COLORS.length]]),
    '#adb5bd'];

  map.addLayer({
    id: 'aza-fill', type: 'fill', source: 'area',
    filter: ['==', ['get', 'kind'], 'aza'],
    paint: { 'fill-color': fillColor, 'fill-opacity': 0.16 },
  });
  map.addLayer({
    id: 'aza-line', type: 'line', source: 'area',
    filter: ['==', ['get', 'kind'], 'aza'],
    paint: { 'line-color': '#ffffff', 'line-width': 1.2, 'line-dasharray': [2, 2], 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'boundary-casing', type: 'line', source: 'area',
    filter: ['==', ['get', 'kind'], 'boundary'],
    paint: { 'line-color': '#212529', 'line-width': 6, 'line-opacity': 0.5 },
  });
  map.addLayer({
    id: 'boundary-line', type: 'line', source: 'area',
    filter: ['==', ['get', 'kind'], 'boundary'],
    paint: { 'line-color': '#ffd43b', 'line-width': 3 },
  });

  for (const f of azaFeatures) {
    const p = f.properties;
    const el = document.createElement('div');
    el.className = 'aza-label';
    el.textContent = p.name;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (activePopup) activePopup.remove();
      const div = document.createElement('div');
      div.innerHTML = `
        <p class="popup-title">${esc(p.name)}</p>
        <p class="popup-meta">上六人部の大字（自治会区域）</p>
        <p class="popup-meta">👨‍👩‍👧 人口 ${p.jinko}人 ／ 🏠 ${p.setai}世帯（2020年国勢調査）</p>`;
      activePopup = new maplibregl.Popup({ offset: 10, maxWidth: '280px' })
        .setLngLat([p.label_lng, p.label_lat])
        .setDOMContent(div)
        .addTo(map);
    });
    areaLabels.push(new maplibregl.Marker({ element: el }).setLngLat([p.label_lng, p.label_lat]).addTo(map));
  }
});

function setAreaVisible(visible) {
  areaVisible = visible;
  const vis = visible ? 'visible' : 'none';
  for (const id of ['aza-fill', 'aza-line', 'boundary-casing', 'boundary-line']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
  }
  areaLabels.forEach((mk) => { mk.getElement().style.display = visible ? '' : 'none'; });
}

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));
map.addControl(new maplibregl.TerrainControl({ source: 'dem', exaggeration: 1.3 }));
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }));
map.addControl(new maplibregl.ScaleControl());

// 写真⇔標準地図の切り替えボタン
class BaseLayerControl {
  onAdd(m) {
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '地図';
    btn.title = '写真⇔標準地図を切り替え';
    btn.style.fontSize = '11px';
    btn.onclick = () => {
      const photoVisible = m.getLayoutProperty('photo', 'visibility') !== 'none';
      m.setLayoutProperty('photo', 'visibility', photoVisible ? 'none' : 'visible');
      m.setLayoutProperty('std', 'visibility', photoVisible ? 'visible' : 'none');
      m.setLayoutProperty('hills', 'visibility', photoVisible ? 'visible' : 'none');
      btn.textContent = photoVisible ? '写真' : '地図';
    };
    this._container.appendChild(btn);
    return this._container;
  }
  onRemove() { this._container.remove(); }
}
map.addControl(new BaseLayerControl());

// 区域（境界・大字）レイヤーの表示切り替えボタン
class AreaToggleControl {
  onAdd() {
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '区域';
    btn.title = '上六人部の境界・大字の表示を切り替え';
    btn.style.fontSize = '11px';
    btn.onclick = () => {
      setAreaVisible(!areaVisible);
      btn.style.opacity = areaVisible ? '1' : '0.4';
    };
    this._container.appendChild(btn);
    return this._container;
  }
  onRemove() { this._container.remove(); }
}
map.addControl(new AreaToggleControl());

// ピン追加モード開始ボタン
class AddPinControl {
  onAdd() {
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '＋ピン';
    btn.title = 'ピンを追加（押してから地図をクリック）';
    btn.style.cssText = 'font-size:11px;width:48px;font-weight:bold;';
    btn.onclick = () => startAdd();
    this._container.appendChild(btn);
    return this._container;
  }
  onRemove() { this._container.remove(); }
}
map.addControl(new AddPinControl());

// 防災レイヤーの表示切り替え。データは国土地理院・ハザードマップ
// ポータルから都度読み込み、アプリ側で防災リスクを断定しない。
const HAZARD_LAYERS = {
  flood: ['hazard-flood'],
  sediment: ['hazard-debris', 'hazard-steep', 'hazard-landslide'],
};
const hazardPanel = document.getElementById('hazard-panel');

class HazardControl {
  onAdd() {
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '防災';
    btn.title = '防災レイヤーを開く';
    btn.style.cssText = 'font-size:11px;width:44px;font-weight:bold;';
    btn.onclick = () => hazardPanel.classList.toggle('hidden');
    this._container.appendChild(btn);
    return this._container;
  }
  onRemove() { this._container.remove(); }
}
map.addControl(new HazardControl());

document.getElementById('hazard-close').onclick = () => hazardPanel.classList.add('hidden');

let shelterMarkers = [];
let sheltersVisible = false;

function tileFor(lng, lat, zoom) {
  const n = 2 ** zoom;
  return {
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n),
  };
}

function shelterHazards(properties) {
  const labels = [];
  if (properties.disaster1) labels.push('洪水');
  if (properties.disaster2) labels.push('土砂災害');
  if (properties.disaster4) labels.push('地震');
  if (properties.disaster6) labels.push('大規模火災');
  if (properties.disaster7) labels.push('内水氾濫');
  return labels;
}

async function loadShelters() {
  const zoom = 10;
  const tile = tileFor(CENTER[0], CENTER[1], zoom);
  const url = `https://cyberjapandata.gsi.go.jp/xyz/skhb04/${zoom}/${tile.x}/${tile.y}.geojson`;
  try {
    const collection = await (await fetch(url)).json();
    const features = collection.features.filter((feature) => {
      const p = feature.properties || {};
      return String(p.name || '').includes('上六人部')
        || String(p.address || '').includes('福知山市字三俣');
    });
    for (const feature of features) {
      const p = feature.properties || {};
      const [lng, lat] = feature.geometry.coordinates;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'shelter-marker';
      el.textContent = '避';
      el.title = `指定緊急避難場所: ${p.name}`;
      el.style.display = sheltersVisible ? '' : 'none';
      el.onclick = (event) => {
        event.stopPropagation();
        if (activePopup) activePopup.remove();
        const hazards = shelterHazards(p);
        const div = document.createElement('div');
        div.innerHTML = `
          <p class="popup-title">${esc(p.name)}</p>
          <span class="popup-cat shelter-cat">指定緊急避難場所</span>
          <p class="popup-meta">${esc(p.address || '')}</p>
          <p class="popup-meta">対象: ${esc(hazards.join('・') || '詳細は自治体情報を確認')}</p>
          <p class="route-warning">経路は候補です。災害時の通行可否や避難指示を必ず確認してください。</p>
          <a class="route-link" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking" target="_blank" rel="noopener">現在地からの経路候補を開く</a>`;
        activePopup = new maplibregl.Popup({ offset: 18, maxWidth: '310px' })
          .setLngLat([lng, lat])
          .setDOMContent(div)
          .addTo(map);
      };
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(map);
      shelterMarkers.push(marker);
    }
  } catch (err) {
    console.warn('指定緊急避難場所を読み込めませんでした', err);
  }
}

function setSheltersVisible(visible) {
  sheltersVisible = visible;
  shelterMarkers.forEach((marker) => {
    marker.getElement().style.display = visible ? '' : 'none';
  });
}

document.querySelectorAll('[data-hazard]').forEach((input) => {
  input.addEventListener('change', () => {
    const kind = input.dataset.hazard;
    if (kind === 'shelter') {
      setSheltersVisible(input.checked);
      return;
    }
    const visibility = input.checked ? 'visible' : 'none';
    for (const id of HAZARD_LAYERS[kind] || []) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    }
  });
});

map.on('load', loadShelters);

// ---- マーカー ----
function clearMarkers() {
  state.markers.forEach((mk) => mk.remove());
  state.markers = [];
}

function renderMarkers() {
  clearMarkers();
  for (const kind of ['spots', 'notes']) {
    for (const item of kmapPinTypes.activeItems(state[kind])) {
      const pinType = kmapPinTypes.typeFor(kind, item.category);
      const el = document.createElement('div');
      el.className = `marker marker-${pinType.id}`;
      el.title = `${pinType.label}: ${item.title}`;
      el.setAttribute('aria-label', `${pinType.label}: ${item.title}`);
      el.addEventListener('click', (e) => {
        e.stopPropagation(); // 地図クリック（追加メニュー）を発火させない
        openDetail(kind, item);
      });
      const mk = new maplibregl.Marker({
        element: el,
        anchor: 'bottom',
        subpixelPositioning: true,
      })
        .setLngLat([item.lng, item.lat])
        .addTo(map);
      state.markers.push(mk);
    }
  }
}

// ---- 詳細ポップアップ ----
let activePopup = null;

function openDetail(kind, item) {
  if (activePopup) activePopup.remove();
  const pinType = kmapPinTypes.typeFor(kind, item.category);
  const div = document.createElement('div');
  const peopleHtml = kind === 'notes' && item.people?.length
    ? `<p class="popup-meta">👥 ${esc(item.people.join('、'))}</p>` : '';
  const dateHtml = kind === 'notes' && item.date
    ? `<p class="popup-meta">📅 ${esc(item.date)}</p>` : '';
  const publicationHtml = item.visibility === 'public'
    ? '<span class="publication-badge">🌐 公開中</span>' : '';
  const photosHtml = item.photos?.length
    ? `<div class="popup-photos">${item.photos.map((f) => `<img data-photo="${esc(f)}" alt="">`).join('')}</div>` : '';
  div.innerHTML = `
    <p class="popup-title">${esc(item.title)}</p>
    <span class="popup-cat" style="background:${pinType.color}">${pinType.icon} ${esc(pinType.label)}</span>
    ${publicationHtml}
    ${dateHtml}${peopleHtml}
    ${photosHtml}
    ${item.text ? `<p class="popup-text">${esc(item.text)}</p>` : ''}
    ${item.source ? `<p class="popup-meta">📎 ${esc(item.source)}</p>` : ''}
    <div class="popup-actions">
      <button data-act="edit">✏️ 編集</button>
      <button data-act="move">📍 移動</button>
      <button data-act="delete" class="danger">🗑 非表示</button>
    </div>`;
  resolvePhotos(div);
  div.querySelectorAll('.popup-photos img').forEach((img) => {
    img.onclick = () => img.src && window.open(img.src); // クリックで原寸表示
  });
  div.querySelector('[data-act="edit"]').onclick = () => {
    activePopup.remove();
    openForm(kind, { lat: item.lat, lng: item.lng }, item);
  };
  div.querySelector('[data-act="move"]').onclick = () => {
    activePopup.remove();
    startMove(kind, item);
  };
  div.querySelector('[data-act="delete"]').onclick = async () => {
    if (!confirm(
      `「${item.title}」を地図から非表示にしますか？\n記録と写真は削除せず、あとで戻せます。`,
    )) return;
    try {
      await api(`/api/${kind}/${item.id}`, 'DELETE', null, item);
      activePopup.remove();
      await loadAll();
    } catch (err) {
      alert(`非表示にできませんでした: ${err.message}`);
    }
  };
  activePopup = new maplibregl.Popup({ offset: 18, maxWidth: '300px' })
    .setLngLat([item.lng, item.lat])
    .setDOMContent(div)
    .addTo(map);
}

// ---- ピン移動・追加モード（誤クリックで発動しないよう、ボタンで明示的に開始する） ----
let moveTarget = null; // { kind, item }
let addMode = false;

function showHint(text) {
  const el = document.getElementById('move-hint');
  el.textContent = text;
  // サイドバーの開閉状態に応じて地図の中央に出す
  el.style.left = document.getElementById('sidebar').classList.contains('collapsed')
    ? '50%' : 'calc(320px + (100% - 320px) / 2)';
  el.classList.remove('hidden');
}

function hideHint() {
  document.getElementById('move-hint').classList.add('hidden');
  map.getCanvas().style.cursor = '';
}

function startMove(kind, item) {
  addMode = false;
  moveTarget = { kind, item };
  showHint(`📍 「${item.title}」の移動先を地図でクリックしてください（Escで中止）`);
  map.getCanvas().style.cursor = 'crosshair';
}

function startAdd() {
  moveTarget = null;
  addMode = true;
  showHint('📍 ピンを追加する場所を地図でクリックしてください（Escで中止）');
  map.getCanvas().style.cursor = 'crosshair';
}

function cancelMode() {
  moveTarget = null;
  addMode = false;
  hideHint();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (moveTarget || addMode)) cancelMode();
});

// ---- 地図クリック：追加モード→種類選択、移動モード→移動確定、通常時は何もしない ----
map.on('click', async (e) => {
  if (moveTarget) {
    const { kind, item } = moveTarget;
    cancelMode();
    try {
      await api(`/api/${kind}/${item.id}`, 'PUT', { lat: e.lngLat.lat, lng: e.lngLat.lng }, item);
      await loadAll();
    } catch (err) {
      alert(`移動できませんでした: ${err.message}`);
    }
    return;
  }
  if (!addMode) {
    if (activePopup) activePopup.remove();
    return;
  }
  cancelMode();
  if (activePopup) activePopup.remove();
  const div = document.createElement('div');
  div.className = 'add-chooser';
  const choices = kmapPinTypes.addChoices()
    .map((type) => `
      <button data-kind="${type.kind}" data-category="${esc(type.category)}">
        ${type.icon} ${esc(type.label)}を追加
      </button>`)
    .join('');
  div.innerHTML = `
    <p class="hint">ここにピンを追加</p>
    ${choices}`;
  div.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => {
      activePopup.remove();
      openForm(
        btn.dataset.kind,
        { lat: e.lngLat.lat, lng: e.lngLat.lng },
        null,
        btn.dataset.category,
      );
    };
  });
  activePopup = new maplibregl.Popup({ closeOnClick: true })
    .setLngLat(e.lngLat)
    .setDOMContent(div)
    .addTo(map);
});

// ---- フォーム（追加・編集） ----
const backdrop = document.getElementById('modal-backdrop');
const form = document.getElementById('item-form');
let formContext = null; // { kind, latlng, existing }
let keepPhotos = []; // 編集中に保持する既存写真
let pendingPhotoUploads = new Map(); // 保存再試行時に同じ写真を重複アップロードしない

function fileKey(file, index) {
  return [file.name, file.size, file.lastModified, index].join(':');
}

function setPhotoStatus(message, isError = false) {
  const el = document.getElementById('photo-status');
  el.textContent = message;
  el.classList.toggle('ng', isError);
}

function renderPhotoPreviews() {
  const wrap = document.getElementById('photo-previews');
  wrap.innerHTML = '';
  keepPhotos.forEach((file, i) => {
    const div = document.createElement('div');
    div.className = 'photo-thumb';
    div.innerHTML = `<img data-photo="${esc(file)}" alt=""><button type="button" title="この写真を外す">×</button>`;
    div.querySelector('button').onclick = () => { keepPhotos.splice(i, 1); renderPhotoPreviews(); };
    wrap.appendChild(div);
  });
  resolvePhotos(wrap);
}

function openForm(kind, latlng, existing = null, initialCategory = null) {
  formContext = { kind, latlng, existing, draftId: existing ? null : genId() };
  document.getElementById('form-title').textContent =
    `${KIND_LABEL[kind]}を${existing ? '編集' : '追加'}`;

  const select = form.elements.category;
  const existingType = existing
    ? kmapPinTypes.typeFor(kind, existing.category)
    : null;
  const formTypes = kmapPinTypes.formCategories(kind, {
    includeMemoSpot: kind === 'spots' && existingType?.id === 'memo',
  });
  select.innerHTML = formTypes
    .map((type) => `<option value="${esc(type.category)}">${type.icon} ${esc(type.label)}</option>`)
    .join('');

  const isNote = kind === 'notes';
  document.getElementById('date-field').style.display = isNote ? '' : 'none';
  document.getElementById('people-field').style.display = isNote ? '' : 'none';

  form.elements.title.value = existing?.title || '';
  form.elements.date.value = existing?.date || today();
  form.elements.category.value = existingType?.category || initialCategory || formTypes[0].category;
  form.elements.people.value = existing?.people?.join(', ') || '';
  form.elements.text.value = existing?.text || '';
  form.elements.source.value = existing?.source || '';
  form.elements.published.checked = existing?.visibility === 'public';
  form.elements.photos.value = '';
  keepPhotos = existing?.photos ? [...existing.photos] : [];
  pendingPhotoUploads = new Map();
  setPhotoStatus('iPhoneのHEIC写真にも対応しています。');
  renderPhotoPreviews();

  backdrop.classList.remove('hidden');
  form.elements.title.focus();
}

function closeForm() {
  if (pendingPhotoUploads.size && !confirm(
    '写真は保存先へアップロード済みですが、記録への反映が完了していません。編集を閉じますか？',
  )) return;
  backdrop.classList.add('hidden');
  formContext = null;
}

document.getElementById('form-cancel').onclick = closeForm;
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeForm(); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { kind, latlng, existing, draftId } = formContext;
  const body = {
    title: form.elements.title.value.trim(),
    category: form.elements.category.value,
    text: form.elements.text.value.trim(),
    lat: latlng.lat,
    lng: latlng.lng,
    visibility: form.elements.published.checked ? 'public' : 'private',
  };
  if (!existing) body.id = draftId;
  if (kind === 'notes') {
    body.date = form.elements.date.value || today();
    body.people = form.elements.people.value
      .split(/[,、]/).map((s) => s.trim()).filter(Boolean);
  }
  const saveBtn = document.getElementById('form-save');
  const originalLabel = saveBtn.textContent;
  saveBtn.disabled = true;
  try {
    const files = [...form.elements.photos.files];
    for (const [i, f] of files.entries()) {
      const key = fileKey(f, i);
      if (pendingPhotoUploads.has(key)) continue;
      saveBtn.textContent = `写真を保存中 ${i + 1}/${files.length}`;
      setPhotoStatus(`「${f.name}」を変換・保存しています…`);
      const blob = await kmapImages.compressImage(f);
      const uploadedName = await kmapStorage.uploadPhoto(blob, `${genId()}.jpg`);
      pendingPhotoUploads.set(key, uploadedName);
    }
    if (files.length) form.elements.photos.value = '';
    saveBtn.textContent = '保存中…';
    const uploaded = [...pendingPhotoUploads.values()];
    body.photos = [...keepPhotos, ...uploaded];
    body.source = form.elements.source.value.trim();
    if (uploaded.length) setPhotoStatus('写真は保存済みです。記録へ反映しています…');
    if (existing) await api(`/api/${kind}/${existing.id}`, 'PUT', body, existing);
    else await api(`/api/${kind}`, 'POST', body);
    pendingPhotoUploads.clear();
    closeForm();
    await loadAll();
  } catch (err) {
    setPhotoStatus(
      pendingPhotoUploads.size
        ? '写真は保存済みですが、記録への反映は未完了です。内容を確認して、もう一度「保存」を押してください。'
        : err.message,
      true,
    );
    alert(`保存できませんでした: ${err.message}`);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalLabel;
  }
});

// ---- サイドバー ----
function filteredItems() {
  const kind = state.activeTab;
  const q = state.query.toLowerCase();
  let items = state[kind].filter((it) => {
    if (it.archivedAt) return false;
    if (state.categoryFilter && kmapPinTypes.typeIdFor(kind, it.category) !== state.categoryFilter) return false;
    if (!q) return true;
    const hay = [it.title, it.text, ...(it.people || [])].join(' ').toLowerCase();
    return hay.includes(q);
  });
  if (kind === 'notes') {
    items = [...items].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  return items;
}

function renderChips() {
  const wrap = document.getElementById('filter-chips');
  wrap.innerHTML = '';
  const all = document.createElement('button');
  all.className = `chip ${state.categoryFilter === null ? 'active' : ''}`;
  all.textContent = 'すべて';
  if (state.categoryFilter === null) all.style.background = '#1b4332';
  all.onclick = () => { state.categoryFilter = null; renderSidebar(); };
  wrap.appendChild(all);
  for (const type of kmapPinTypes.formCategories(state.activeTab)) {
    const chip = document.createElement('button');
    chip.className = `chip ${state.categoryFilter === type.id ? 'active' : ''}`;
    chip.textContent = `${type.icon} ${type.label}`;
    if (state.categoryFilter === type.id) chip.style.background = type.color;
    chip.onclick = () => { state.categoryFilter = type.id; renderSidebar(); };
    wrap.appendChild(chip);
  }
}

function renderList() {
  const kind = state.activeTab;
  const list = document.getElementById('item-list');
  list.innerHTML = '';
  const items = filteredItems();
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty-msg';
    li.style.cursor = 'default';
    li.textContent = kind === 'notes'
      ? 'まだ記録がありません。地図をクリックして最初の記録を残しましょう。'
      : '該当する場所がありません。';
    list.appendChild(li);
    return;
  }
  for (const item of items) {
    const pinType = kmapPinTypes.typeFor(kind, item.category);
    const li = document.createElement('li');
    const meta = kind === 'notes'
      ? [item.date, item.people?.length ? `👥 ${item.people.join('、')}` : '']
      : [`${pinType.icon} ${pinType.label}`];
    li.innerHTML = `
      <div class="item-top">
        <span class="pin-symbol" aria-hidden="true">${pinType.icon}</span>
        <span class="item-title">${esc(item.title)}</span>
        ${item.visibility === 'public' ? '<span class="publication-badge">🌐 公開中</span>' : ''}
      </div>
      <div class="item-meta">${esc(meta.filter(Boolean).join(' ／ '))}</div>
      ${item.text ? `<div class="item-text">${esc(item.text)}</div>` : ''}`;
    li.onclick = () => {
      map.flyTo({ center: [item.lng, item.lat], zoom: 15.2, pitch: 55 });
      openDetail(kind, item);
      // スマホではシートを閉じて地図を見せる
      if (window.matchMedia('(max-width: 700px)').matches) {
        document.getElementById('sidebar').classList.add('collapsed');
        document.getElementById('sidebar-open').style.display = 'block';
      }
    };
    list.appendChild(li);
  }
}

function renderSidebar() {
  const notesCount = kmapPinTypes.activeItems(state.notes).length;
  const spotsCount = kmapPinTypes.activeItems(state.spots).length;
  document.getElementById('notes-count').textContent = notesCount || '';
  document.getElementById('spots-count').textContent = spotsCount || '';
  renderChips();
  renderList();
}

// ---- 非表示ピン（記録を消さず、復元できる） ----
const trashBackdrop = document.getElementById('trash-backdrop');

function renderTrash() {
  const list = document.getElementById('trash-list');
  list.innerHTML = '';
  const archived = ['notes', 'spots'].flatMap((kind) => state[kind]
    .filter((item) => item.archivedAt)
    .map((item) => ({ kind, item })));

  if (!archived.length) {
    const li = document.createElement('li');
    li.className = 'trash-empty';
    li.textContent = '非表示にしたピンはありません。';
    list.appendChild(li);
    return;
  }

  archived.sort((a, b) => (b.item.archivedAt || '').localeCompare(a.item.archivedAt || ''));
  for (const { kind, item } of archived) {
    const pinType = kmapPinTypes.typeFor(kind, item.category);
    const li = document.createElement('li');
    li.innerHTML = `
      <div><strong>${pinType.icon} ${esc(item.title)}</strong><br>
      <span>${new Date(item.archivedAt).toLocaleString('ja-JP')}</span></div>
      <button type="button">地図へ戻す</button>`;
    li.querySelector('button').onclick = async () => {
      const button = li.querySelector('button');
      button.disabled = true;
      try {
        await api(`/api/${kind}/${item.id}`, 'RESTORE', null, item);
        await loadAll();
        renderTrash();
      } catch (err) {
        alert(`復元できませんでした: ${err.message}`);
      } finally {
        button.disabled = false;
      }
    };
    list.appendChild(li);
  }
}

document.getElementById('trash-open').onclick = () => {
  renderTrash();
  trashBackdrop.classList.remove('hidden');
};
document.getElementById('trash-close').onclick = () => trashBackdrop.classList.add('hidden');
trashBackdrop.addEventListener('click', (event) => {
  if (event.target === trashBackdrop) trashBackdrop.classList.add('hidden');
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    state.activeTab = tab.dataset.tab;
    state.categoryFilter = null;
    renderSidebar();
  };
});

document.getElementById('search').addEventListener('input', (e) => {
  state.query = e.target.value;
  renderList();
});

// ---- サイドバーの格納・展開 ----
const sidebarEl = document.getElementById('sidebar');
const sidebarOpenBtn = document.getElementById('sidebar-open');

document.getElementById('sidebar-toggle').onclick = () => {
  sidebarEl.classList.add('collapsed');
  sidebarOpenBtn.style.display = 'block';
};

sidebarOpenBtn.onclick = () => {
  sidebarEl.classList.remove('collapsed');
  sidebarOpenBtn.style.display = 'none';
};

const isMobile = () => window.matchMedia('(max-width: 700px)').matches;

// スマホでは地図ファーストで起動（シートは閉じた状態から）
if (isMobile()) {
  sidebarEl.classList.add('collapsed');
  sidebarOpenBtn.style.display = 'block';
}

// ---- 初期ロード ----
async function loadAll() {
  if (DEMO_MODE) {
    state.notes = DEMO_DATA.notes.map((item) => ({ ...item }));
    state.spots = DEMO_DATA.spots.map((item) => ({ ...item }));
    renderMarkers();
    renderSidebar();
    return;
  }
  [state.notes, state.spots] = await Promise.all([api('/api/notes'), api('/api/spots')]);
  renderMarkers();
  renderSidebar();
}

// ---- 保存先の設定（初回セットアップ） ----
const setupBackdrop = document.getElementById('setup-backdrop');
const setupForm = document.getElementById('setup-form');
const setupStatus = document.getElementById('setup-status');

function openSetup() {
  const cfg = kmapStorage.loadConfig();
  if (cfg) {
    setupForm.elements.owner.value = cfg.owner || '';
    setupForm.elements.repo.value = cfg.repo || '';
    setupForm.elements.token.value = cfg.token || '';
  }
  setupStatus.textContent = '';
  setupStatus.className = '';
  setupBackdrop.classList.remove('hidden');
}

setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cfg = {
    owner: setupForm.elements.owner.value.trim(),
    repo: setupForm.elements.repo.value.trim(),
    token: setupForm.elements.token.value.trim(),
    branch: 'main',
  };
  const btn = document.getElementById('setup-save');
  btn.disabled = true;
  setupStatus.textContent = '接続を確認しています…';
  setupStatus.className = '';
  try {
    const info = await kmapStorage.testConnection(cfg);
    kmapStorage.saveConfig(cfg);
    setupStatus.textContent = `✅ ${info.repo} に接続しました${info.private ? '（非公開リポジトリ）' : ''}`;
    setupStatus.className = 'ok';
    await loadAll();
    setTimeout(() => setupBackdrop.classList.add('hidden'), 900);
  } catch (err) {
    setupStatus.textContent = `❌ ${err.message}`;
    setupStatus.className = 'ng';
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('setup-clear').onclick = () => {
  if (!confirm('この端末に保存したトークンを削除しますか？（記録そのものは消えません）')) return;
  kmapStorage.clearConfig();
  setupForm.elements.token.value = '';
  setupStatus.textContent = 'トークンを削除しました';
  setupStatus.className = '';
};

// 設定を開き直すためのボタン
class SettingsControl {
  onAdd() {
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '⚙';
    btn.title = '保存先の設定';
    btn.onclick = openSetup;
    this._container.appendChild(btn);
    return this._container;
  }
  onRemove() { this._container.remove(); }
}
map.addControl(new SettingsControl());

// ---- 起動 ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js?v=13').catch(() => { /* 未対応環境では黙って諦める */ });
  });
}

window.addEventListener('online', () => loadAll().catch(() => {}));
window.addEventListener('offline', () => setOfflineBanner(true));

kmapStorage.loadConfig();
if (DEMO_MODE) {
  loadAll().catch((err) => alert(`デモを読み込めませんでした: ${err.message}`));
} else if (kmapStorage.hasConfig()) {
  loadAll().catch((err) => {
    alert(`データを読み込めませんでした: ${err.message}`);
    openSetup();
  });
} else {
  openSetup();
}

// safety net: embedded/panel browsers can miss maplibre's built-in resize tracking
new ResizeObserver(() => map.resize()).observe(document.getElementById('map'));

// debug hook (console / automated testing)
window._kmap = { map, state, openForm, loadAll };
