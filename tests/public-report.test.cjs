'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('公開ページは読み取り専用で編集用credentialを要求しない', () => {
  const html = read('report/index.html');
  const app = read('report/app.js');
  assert.doesNotMatch(html, /アクセストークン|setup-form|item-form/);
  assert.doesNotMatch(app, /api\.github\.com|method:\s*['"](?:PUT|POST|DELETE)/);
  assert.match(html, /noindex,nofollow/);
});

test('公開ページは公開スナップショットを常に再取得できる', () => {
  const app = read('report/app.js');
  assert.match(app, /public-data\/notes\.json/);
  assert.match(app, /cache:\s*['"]no-store['"]/);
  assert.match(app, /setInterval/);
});

test('モバイル表示と地点固定マーカーを維持する', () => {
  const app = read('report/app.js');
  const css = read('report/style.css');
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /height:\s*46svh/);
  assert.match(css, /\.report-marker\s*\{[\s\S]*position:\s*absolute/);
  assert.match(app, /anchor:\s*['"]bottom['"]/);
  assert.match(app, /subpixelPositioning:\s*true/);
});

test('編集画面は公開対象を明示的に選ぶ', () => {
  const html = read('index.html');
  const app = read('app.js');
  assert.match(html, /name="published" type="checkbox"/);
  assert.match(app, /visibility:\s*form\.elements\.published\.checked \? 'public' : 'private'/);
});

test('初期公開データは空で、誤って既存記録を公開しない', () => {
  assert.deepEqual(JSON.parse(read('public-data/notes.json')), []);
  assert.deepEqual(JSON.parse(read('public-data/spots.json')), []);
});
