// storage.js — GitHub リポジトリを保存先として使うストレージ層。
// 記録・図鑑・写真はすべて private リポジトリへコミットされる（＝履歴が残る）。
// アクセストークンは端末の localStorage にのみ保存し、コードには一切含めない。
'use strict';

const CONFIG_KEY = 'kmap.config';
const CACHE_KEY = 'kmap.cache';
const API = 'https://api.github.com';

const store = {
  config: null,     // { token, owner, repo, branch }
  shas: {},         // path -> 最新の blob sha（更新時の競合検出に使う）
  online: navigator.onLine,
};

// ---- 設定 ----
function loadConfig() {
  try {
    store.config = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
  } catch {
    store.config = null;
  }
  return store.config;
}

function saveConfig(cfg) {
  store.config = cfg;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

function clearConfig() {
  store.config = null;
  localStorage.removeItem(CONFIG_KEY);
}

function hasConfig() {
  return !!(store.config && store.config.token && store.config.owner && store.config.repo);
}

// ---- UTF-8 対応の base64 変換（日本語がそのまま通るように） ----
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000; // 大きい画像でも stack overflow しないよう分割
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// ---- GitHub API ----
async function gh(path, options = {}) {
  const { token, owner, repo } = store.config;
  // リポジトリ直下の接続テストでは末尾の `/` を付けない。
  // GitHub API は末尾 `/` 付きURLへのCORS preflightを404にするため、
  // ブラウザでは認証結果を受け取る前に `Failed to fetch` になる。
  const repoUrl = `${API}/repos/${owner}/${repo}`;
  const res = await fetch(path ? `${repoUrl}/${path}` : repoUrl, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).message || detail;
    } catch { /* JSON でないレスポンスはそのまま */ }
    const err = new Error(`GitHub: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

async function readFile(path) {
  const branch = store.config.branch || 'main';
  const res = await gh(`contents/${path}?ref=${branch}`, { cache: 'no-store' });
  const json = await res.json();
  store.shas[path] = json.sha;
  return json.content ? base64ToUtf8(json.content) : '';
}

async function writeFile(path, base64Content, message) {
  const branch = store.config.branch || 'main';
  const body = {
    message,
    content: base64Content,
    branch,
  };
  if (store.shas[path]) body.sha = store.shas[path];
  const res = await gh(`contents/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  store.shas[path] = json.content.sha;
  return json;
}

// ---- コレクション（notes / spots） ----
const pathOf = (kind) => `data/${kind}.json`;

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeCache(kind, items) {
  const cache = readCache();
  cache[kind] = items;
  cache.savedAt = new Date().toISOString();
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

// オフライン時はキャッシュを返す（閲覧はできる、書き込みだけ不可）
async function loadCollection(kind) {
  try {
    const text = await readFile(pathOf(kind));
    const items = JSON.parse(text || '[]');
    writeCache(kind, items);
    store.online = true;
    return { items, fromCache: false };
  } catch (err) {
    const cached = readCache()[kind];
    if (cached) {
      store.online = false;
      return { items: cached, fromCache: true };
    }
    throw err;
  }
}

async function saveCollection(kind, items, message) {
  const path = pathOf(kind);
  try {
    await writeFile(path, utf8ToBase64(JSON.stringify(items, null, 2) + '\n'), message);
  } catch (err) {
    // 別端末が先に更新していた場合は sha を取り直して 1 度だけやり直す
    if (err.status === 409 || err.status === 422) {
      await readFile(path);
      await writeFile(path, utf8ToBase64(JSON.stringify(items, null, 2) + '\n'), message);
    } else {
      throw err;
    }
  }
  writeCache(kind, items);
}

// ---- 写真 ----
// private リポジトリの画像は URL で直接開けないため、API で取得して blob URL にする。
const photoUrls = new Map();

async function photoUrl(name) {
  if (photoUrls.has(name)) return photoUrls.get(name);
  const branch = store.config.branch || 'main';
  const { token, owner, repo } = store.config;
  const res = await fetch(`${API}/repos/${owner}/${repo}/contents/data/photos/${name}?ref=${branch}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.raw',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`写真を取得できません: ${name}`);
  const url = URL.createObjectURL(await res.blob());
  photoUrls.set(name, url);
  return url;
}

async function uploadPhoto(blob, name) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await writeFile(`data/photos/${name}`, bytesToBase64(bytes), `photo: add ${name}`);
  photoUrls.set(name, URL.createObjectURL(blob));
  return name;
}

// ---- 接続テスト ----
async function testConnection(cfg) {
  const prev = store.config;
  store.config = cfg;
  try {
    const res = await gh('');
    const info = await res.json();
    await readFile(pathOf('notes')); // データファイルまで読めるか確認
    return { ok: true, repo: info.full_name, private: info.private };
  } catch (err) {
    store.config = prev;
    throw err;
  }
}

window.kmapStorage = {
  loadConfig, saveConfig, clearConfig, hasConfig,
  loadCollection, saveCollection,
  photoUrl, uploadPhoto,
  testConnection,
  isOnline: () => store.online,
  cacheSavedAt: () => readCache().savedAt,
};
