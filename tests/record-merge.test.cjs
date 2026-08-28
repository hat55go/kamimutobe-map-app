'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeItem, mergePhotoRefs, assertSafeDelete, archiveItem, restoreItem, parseApiPath,
} = require('../record-merge.js');

const base = {
  id: 'spot-1',
  title: '生野神社',
  category: '神社仏閣',
  text: '元のメモ',
  lat: 35.2,
  lng: 135.2,
  photos: ['old.jpg'],
  createdAt: '2026-08-01T00:00:00.000Z',
};

test('別項目の同時編集は両方を保持する', () => {
  const latest = { ...base, title: '生野神社（式内社）' };
  const candidate = { ...base, text: '由緒を追記' };
  const merged = mergeItem(base, latest, candidate);
  assert.equal(merged.title, '生野神社（式内社）');
  assert.equal(merged.text, '由緒を追記');
  assert.equal(merged.id, base.id);
});

test('同じ項目の競合は上書きせず停止する', () => {
  const latest = { ...base, text: '別端末の追記' };
  const candidate = { ...base, text: '手元の追記' };
  assert.throws(() => mergeItem(base, latest, candidate), (err) => {
    assert.equal(err.code, 'RECORD_CONFLICT');
    assert.deepEqual(err.fields, ['text']);
    return true;
  });
});

test('別端末と手元の追加写真をどちらも保持する', () => {
  assert.deepEqual(
    mergePhotoRefs(['old.jpg'], ['old.jpg', 'remote.jpg'], ['old.jpg', 'local.jpg']),
    ['old.jpg', 'remote.jpg', 'local.jpg'],
  );
});

test('編集中に対象が変更された場合は削除を止める', () => {
  assert.throws(() => assertSafeDelete(base, { ...base, text: '更新済み' }), (err) => {
    assert.equal(err.code, 'RECORD_CONFLICT');
    return true;
  });
});

test('削除操作は内容を残したまま非表示にする', () => {
  const archived = archiveItem(base, base, '2026-08-28T01:00:00.000Z');
  assert.equal(archived.archivedAt, '2026-08-28T01:00:00.000Z');
  assert.equal(archived.title, base.title);
  assert.deepEqual(archived.photos, base.photos);
});

test('非表示ピンを内容そのままで復元する', () => {
  const archived = archiveItem(base, base, '2026-08-28T01:00:00.000Z');
  const restored = restoreItem(archived, archived, '2026-08-28T02:00:00.000Z');
  assert.equal(restored.archivedAt, null);
  assert.equal(restored.text, base.text);
  assert.deepEqual(restored.photos, base.photos);
});

test('初期地点のハイフン付きIDを編集パスとして受け付ける', () => {
  assert.deepEqual(parseApiPath('/api/spots/seed-ikuno'), {
    kind: 'spots',
    id: 'seed-ikuno',
  });
});
