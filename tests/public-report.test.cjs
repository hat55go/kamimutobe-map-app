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

test('Mac内の公開ページを直接開いた場合は正式な公開URLへ移動する', () => {
  const html = read('report/index.html');
  assert.match(html, /window\.location\.protocol === 'file:'/);
  assert.match(html, /window\.location\.replace\('https:\/\/hat55go\.github\.io\/kamimutobe-map-app\/report\/'\)/);
});

test('公開ページは公開スナップショットを常に再取得できる', () => {
  const app = read('report/app.js');
  assert.match(app, /public-data\/notes\.json/);
  assert.match(app, /cache:\s*['"]no-store['"]/);
  assert.match(app, /setInterval/);
});

test('一覧カードは詳細モーダルを開かず地図だけを移動する', () => {
  const app = read('report/app.js');
  const renderCards = app.match(/function renderCards\(\)[\s\S]*?\n}\n\nconst detailBackdrop/);
  assert.ok(renderCards, 'renderCards block should be found');
  assert.match(renderCards[0], /focusMapOnItem\(item\)/);
  assert.doesNotMatch(renderCards[0], /openDetail\(/);
  assert.match(app, /scrollIntoView/);
});

test('全体表示ボタンは公開中の全ピンへ表示範囲を戻す', () => {
  const html = read('report/index.html');
  const app = read('report/app.js');
  assert.match(html, /id="fit-all-button"/);
  assert.match(app, /function showAllItems\(\)/);
  assert.match(app, /map\.fitBounds\(bounds/);
  assert.match(app, /fit-all-button'\)\.onclick = showAllItems/);
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

test('公開データの件数が一致し、非公開フィールドを含まない', () => {
  const notes = JSON.parse(read('public-data/notes.json'));
  const spots = JSON.parse(read('public-data/spots.json'));
  const meta = JSON.parse(read('public-data/meta.json'));
  assert.equal(notes.length, meta.counts.notes);
  assert.equal(spots.length, meta.counts.spots);
  for (const item of [...notes, ...spots]) {
    assert.equal('people' in item, false);
    assert.equal('visibility' in item, false);
    assert.equal('archivedAt' in item, false);
  }
});
