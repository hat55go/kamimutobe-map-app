'use strict';

// ---- 定数 ----
const CENTER = [135.207, 35.250]; // 上六人部（土師川中流域）の中心付近
const CATEGORIES = {
  notes: {
    '出会った人': '#e8590c',
    '出来事': '#f08c00',
    '気づき': '#2f9e44',
    'その他': '#868e96',
  },
  spots: {
    '集落': '#1971c2',
    '施設': '#6741d9',
    '神社仏閣': '#9c36b5',
    'お店': '#c2255c',
    '自然': '#099268',
    'その他': '#495057',
  },
};
const KIND_LABEL = { notes: '記録', spots: '場所' };

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

function catColor(kind, category) {
  return CATEGORIES[kind][category] || CATEGORIES[kind]['その他'];
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

// iPhone の HEIC やサイズの大きい写真をそのまま送るとリポジトリが重くなるため、
// ブラウザ側で長辺 2400px の JPEG に変換してから保存する。
async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  if (!blob) throw new Error('画像を変換できませんでした');
  return blob;
}

// 旧サーバ API と同じ呼び出し方のまま、中身を GitHub への読み書きに差し替えている。
// 書き込みは毎回リポジトリの最新を読んでから更新するので、他端末の変更を踏み潰さない。
async function api(path, method = 'GET', body) {
  const m = path.match(/^\/api\/(notes|spots)(?:\/([\w]+))?$/);
  if (!m) throw new Error(`不正なパス: ${path}`);
  const [, kind, id] = m;
  const label = kind === 'notes' ? '記録' : '場所';

  if (method === 'GET') {
    const { items, fromCache } = await kmapStorage.loadCollection(kind);
    setOfflineBanner(fromCache);
    return items;
  }

  const { items, fromCache } = await kmapStorage.loadCollection(kind);
  if (fromCache) throw new Error('オフラインのため保存できません（電波が戻ってからもう一度）');

  if (method === 'POST') {
    const item = { ...body, id: genId(), createdAt: new Date().toISOString() };
    items.push(item);
    await kmapStorage.saveCollection(kind, items, `${kind}: add ${item.title}`);
    return item;
  }

  const index = items.findIndex((it) => it.id === id);
  if (index === -1) throw new Error(`${label}が見つかりません`);

  if (method === 'PUT') {
    const merged = { ...items[index], ...body, id };
    items[index] = merged;
    await kmapStorage.saveCollection(kind, items, `${kind}: update ${merged.title}`);
    return merged;
  }

  if (method === 'DELETE') {
    const [removed] = items.splice(index, 1);
    await kmapStorage.saveCollection(kind, items, `${kind}: delete ${removed.title}`);
    return removed;
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
    },
    layers: [
      { id: 'photo', type: 'raster', source: 'photo' },
      { id: 'std', type: 'raster', source: 'std', layout: { visibility: 'none' } },
      // aerial photos already contain natural shading — hillshade is only for the plain map
      { id: 'hills', type: 'hillshade', source: 'dem', layout: { visibility: 'none' }, paint: { 'hillshade-exaggeration': 0.25 } },
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

// ---- マーカー ----
function clearMarkers() {
  state.markers.forEach((mk) => mk.remove());
  state.markers = [];
}

function renderMarkers() {
  clearMarkers();
  for (const kind of ['spots', 'notes']) {
    for (const item of state[kind]) {
      const el = document.createElement('div');
      el.className = `marker ${kind === 'spots' ? 'spot' : 'note'}`;
      el.style.background = catColor(kind, item.category);
      el.addEventListener('click', (e) => {
        e.stopPropagation(); // 地図クリック（追加メニュー）を発火させない
        openDetail(kind, item);
      });
      const mk = new maplibregl.Marker({ element: el, anchor: kind === 'spots' ? 'center' : 'bottom' })
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
  const div = document.createElement('div');
  const peopleHtml = kind === 'notes' && item.people?.length
    ? `<p class="popup-meta">👥 ${esc(item.people.join('、'))}</p>` : '';
  const dateHtml = kind === 'notes' && item.date
    ? `<p class="popup-meta">📅 ${esc(item.date)}</p>` : '';
  const photosHtml = item.photos?.length
    ? `<div class="popup-photos">${item.photos.map((f) => `<img data-photo="${esc(f)}" alt="">`).join('')}</div>` : '';
  div.innerHTML = `
    <p class="popup-title">${esc(item.title)}</p>
    <span class="popup-cat" style="background:${catColor(kind, item.category)}">${esc(item.category || 'その他')}</span>
    ${dateHtml}${peopleHtml}
    ${photosHtml}
    ${item.text ? `<p class="popup-text">${esc(item.text)}</p>` : ''}
    ${item.source ? `<p class="popup-meta">📎 ${esc(item.source)}</p>` : ''}
    <div class="popup-actions">
      <button data-act="edit">✏️ 編集</button>
      <button data-act="move">📍 移動</button>
      <button data-act="delete" class="danger">🗑 削除</button>
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
    if (!confirm(`「${item.title}」を削除しますか？`)) return;
    await api(`/api/${kind}/${item.id}`, 'DELETE');
    activePopup.remove();
    await loadAll();
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
    await api(`/api/${kind}/${item.id}`, 'PUT', { lat: e.lngLat.lat, lng: e.lngLat.lng });
    await loadAll();
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
  div.innerHTML = `
    <p class="hint">ここにピンを追加</p>
    <button data-kind="notes">📖 記録を追加（日記・出会い）</button>
    <button data-kind="spots">📍 場所を追加（図鑑）</button>`;
  div.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => {
      activePopup.remove();
      openForm(btn.dataset.kind, { lat: e.lngLat.lat, lng: e.lngLat.lng });
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

function openForm(kind, latlng, existing = null) {
  formContext = { kind, latlng, existing };
  document.getElementById('form-title').textContent =
    `${KIND_LABEL[kind]}を${existing ? '編集' : '追加'}`;

  const select = form.elements.category;
  select.innerHTML = Object.keys(CATEGORIES[kind])
    .map((c) => `<option>${esc(c)}</option>`).join('');

  const isNote = kind === 'notes';
  document.getElementById('date-field').style.display = isNote ? '' : 'none';
  document.getElementById('people-field').style.display = isNote ? '' : 'none';

  form.elements.title.value = existing?.title || '';
  form.elements.date.value = existing?.date || today();
  form.elements.category.value = existing?.category || Object.keys(CATEGORIES[kind])[0];
  form.elements.people.value = existing?.people?.join(', ') || '';
  form.elements.text.value = existing?.text || '';
  form.elements.source.value = existing?.source || '';
  form.elements.photos.value = '';
  keepPhotos = existing?.photos ? [...existing.photos] : [];
  renderPhotoPreviews();

  backdrop.classList.remove('hidden');
  form.elements.title.focus();
}

function closeForm() {
  backdrop.classList.add('hidden');
  formContext = null;
}

document.getElementById('form-cancel').onclick = closeForm;
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeForm(); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { kind, latlng, existing } = formContext;
  const body = {
    title: form.elements.title.value.trim(),
    category: form.elements.category.value,
    text: form.elements.text.value.trim(),
    lat: latlng.lat,
    lng: latlng.lng,
  };
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
    const uploaded = [];
    for (const [i, f] of files.entries()) {
      saveBtn.textContent = `写真を保存中 ${i + 1}/${files.length}`;
      const blob = await compressImage(f);
      uploaded.push(await kmapStorage.uploadPhoto(blob, `${genId()}.jpg`));
    }
    saveBtn.textContent = '保存中…';
    body.photos = [...keepPhotos, ...uploaded];
    body.source = form.elements.source.value.trim();
    if (existing) await api(`/api/${kind}/${existing.id}`, 'PUT', body);
    else await api(`/api/${kind}`, 'POST', body);
    closeForm();
    await loadAll();
  } catch (err) {
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
    if (state.categoryFilter && it.category !== state.categoryFilter) return false;
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
  for (const [cat, color] of Object.entries(CATEGORIES[state.activeTab])) {
    const chip = document.createElement('button');
    chip.className = `chip ${state.categoryFilter === cat ? 'active' : ''}`;
    chip.textContent = cat;
    if (state.categoryFilter === cat) chip.style.background = color;
    chip.onclick = () => { state.categoryFilter = cat; renderSidebar(); };
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
    const li = document.createElement('li');
    const meta = kind === 'notes'
      ? [item.date, item.people?.length ? `👥 ${item.people.join('、')}` : '']
      : [item.category];
    li.innerHTML = `
      <div class="item-top">
        <span class="dot" style="background:${catColor(kind, item.category)}"></span>
        <span class="item-title">${esc(item.title)}</span>
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
  document.getElementById('notes-count').textContent = state.notes.length || '';
  document.getElementById('spots-count').textContent = state.spots.length || '';
  renderChips();
  renderList();
}

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
    navigator.serviceWorker.register('./sw.js?v=3').catch(() => { /* 未対応環境では黙って諦める */ });
  });
}

window.addEventListener('online', () => loadAll().catch(() => {}));
window.addEventListener('offline', () => setOfflineBanner(true));

kmapStorage.loadConfig();
if (kmapStorage.hasConfig()) {
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
