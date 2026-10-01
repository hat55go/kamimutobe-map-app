'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const journal = require('../spot-journal.js');
const { mergeItem } = require('../record-merge.js');
const timestamp = '2026-10-01T04:00:00.000Z';
const draft = { id: 'addition-1', date: '2026-10-01', time: '13:00', text: '再訪して参道の整備を確認した。' };

test('record date uses explicit fields or original creation in Japan, never an edit timestamp', () => {
  assert.deepEqual(journal.recordedFields({ createdAt: '2026-09-30T16:05:00Z', updatedAt: timestamp }), { date: '2026-10-01', time: '01:05' });
  assert.deepEqual(journal.recordedFields({ updatedAt: timestamp }), { date: '', time: '' });
  assert.deepEqual(journal.recordedFields({ createdAt: 'invalid' }), { date: '', time: '' });
  assert.deepEqual(journal.recordedFields({ recordedDate: '', recordedTime: '', createdAt: timestamp }), { date: '', time: '' });
  assert.deepEqual(journal.recordedFields({ recordedDate: '2026-09-25', recordedTime: '', createdAt: timestamp }), { date: '2026-09-25', time: '' });
});

test('journal validates real civil dates and optional times without changing day-only records', () => {
  assert.deepEqual(journal.dateTimeFields('', ''), { date: '', time: '' });
  assert.deepEqual(journal.additionFields({ ...draft, date: '2024-02-29', time: '', text: ' 内容 ' }), { date: '2024-02-29', time: '', text: '内容' });
  for (const date of ['', '2026-02-29', '2026-04-31', '0000-01-01', 'not-a-date']) {
    assert.throws(() => journal.additionFields({ ...draft, date }));
  }
  for (const time of ['24:00', '12:60', '9:00']) assert.throws(() => journal.additionFields({ ...draft, time }));
  assert.throws(() => journal.dateTimeFields('', '13:00'));
  assert.throws(() => journal.additionFields({ ...draft, text: ' ' }));
});

test('adding and editing retains original place data and all other additions', () => {
  const place = { id: 'shrine', text: '元の説明', photos: ['shrine.jpg'], peopleIds: ['p1'], recordedDate: '2026-09-25', additions: [] };
  const first = journal.upsertAddition(place, draft, timestamp);
  const second = journal.upsertAddition({ ...place, additions: first }, { ...draft, id: 'addition-2', date: '2026-09-29', time: '' }, timestamp);
  const edited = journal.upsertAddition({ additions: second }, { ...draft, text: '参道と境内を確認した。' }, '2026-10-02T00:00:00Z');
  assert.equal(edited.length, 2);
  assert.equal(edited[0].createdAt, timestamp);
  assert.equal(edited[1], second[1]);
  const saved = mergeItem(place, place, { additions: edited });
  assert.deepEqual(saved.photos, place.photos);
  assert.deepEqual(saved.peopleIds, place.peopleIds);
  assert.equal(saved.text, place.text);
  assert.equal(saved.recordedDate, place.recordedDate);
  assert.deepEqual(place.additions, []);
  assert.equal(journal.additionLabel(edited[1]), '2026.09.29 追記');
  assert.equal(journal.additionLabel(edited[0]), '2026.10.01 追記 · 13:00');
  assert.match(journal.searchText(saved), /境内/);
});

test('journal sorts by occurrence date without mutating storage order', () => {
  const place = { additions: [
    { ...draft, id: 'a', date: '2026-09-29' },
    { ...draft, id: 'b', time: '' },
    { ...draft, id: 'c', time: '14:00' },
    { ...draft, id: 'd', time: '09:00' },
  ] };
  assert.deepEqual(journal.additionsFor(place).map((item) => item.id), ['c', 'd', 'b', 'a']);
  assert.deepEqual(place.additions.map((item) => item.id), ['a', 'b', 'c', 'd']);
});

test('retry after lost response is idempotent, unrelated changes merge, competing additions stop', () => {
  const base = { id: 'nature', text: '自然の記録', photos: ['tree.jpg'] };
  const candidate = { additions: journal.upsertAddition(base, draft, timestamp) };
  const saved = mergeItem(base, { ...base, text: '他端末の説明' }, candidate);
  const retry = mergeItem(base, saved, candidate);
  assert.equal(retry.additions.length, 1);
  assert.equal(retry.text, '他端末の説明');
  assert.deepEqual(retry.photos, base.photos);
  const other = { ...base, additions: journal.upsertAddition(base, { ...draft, id: 'other' }, timestamp) };
  assert.throws(() => mergeItem(base, other, candidate), (error) => error.code === 'RECORD_CONFLICT');
  assert.equal(other.additions[0].id, 'other');
});
