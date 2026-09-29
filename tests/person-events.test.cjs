'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  eventFields, upsertEvent, eventsForPerson, eventDateLabel, japanDateTime,
} = require('../people-directory.js');
const { mergeItem } = require('../record-merge.js');

const timestamp = '2026-09-29T05:30:00.000Z';
const draft = { id: 'e1', date: '2026-09-20', time: '14:30', text: 'お話を伺った' };

test('legacy people can gain events without changing their profile or audit dates', () => {
  const person = { id: 'p1', name: '田中さん', description: '地域の方', photos: ['face.jpg'] };
  const before = structuredClone(person);
  assert.deepEqual(eventsForPerson(person), []);
  const events = upsertEvent(person, draft, timestamp);
  assert.deepEqual(person, before);
  const saved = mergeItem(person, person, { events });
  for (const key of Object.keys(person)) assert.deepEqual(saved[key], person[key]);
  assert.deepEqual(saved.events[0], { ...draft, createdAt: timestamp, updatedAt: timestamp });
  assert.equal(saved.events[0].date, '2026-09-20');
});

test('date is required and must be a real calendar day, time is optional', () => {
  assert.deepEqual(eventFields({ date: '2024-02-29', text: '  訪問  ' }), {
    date: '2024-02-29', time: '', text: '訪問',
  });
  for (const date of ['', '2026-02-29', '2026-04-31', '2026-13-01', '0000-01-01', '2026-9-2']) {
    assert.throws(() => eventFields({ ...draft, date }), /日付/);
  }
  for (const time of ['24:00', '12:60', '9:30', '2026-09-29T14:30']) {
    assert.throws(() => eventFields({ ...draft, time }), /時刻/);
  }
  assert.equal(eventFields({ ...draft, time: '00:00' }).time, '00:00');
  assert.throws(() => eventFields({ ...draft, text: ' \n ' }), /内容/);
});

test('events sort by occurrence date and time, not by when they were edited', () => {
  const person = { events: [
    { ...draft, id: 'date-only', time: '', updatedAt: '2099-01-01' },
    { ...draft, id: 'midnight', time: '00:00' },
    { ...draft, id: 'afternoon', time: '14:30' },
    { ...draft, id: 'next-day', date: '2026-09-21', time: '' },
  ] };
  assert.deepEqual(eventsForPerson(person).map((event) => event.id), [
    'next-day', 'afternoon', 'midnight', 'date-only',
  ]);
  assert.equal(person.events[0].id, 'date-only');
  assert.equal(eventDateLabel(draft), '2026年9月20日 14:30');
  assert.equal(eventDateLabel({ ...draft, time: '' }), '2026年9月20日（時刻未記録）');
});

test('current date and time use Japan time across UTC day boundaries', () => {
  assert.deepEqual(japanDateTime(new Date('2026-09-29T15:05:00Z')), {
    date: '2026-09-30', time: '00:05',
  });
});

test('editing keeps event identity, creation time, and other events', () => {
  const original = upsertEvent({}, draft, timestamp);
  const person = { events: upsertEvent({ events: original }, { ...draft, id: 'e2' }, timestamp) };
  const edited = upsertEvent(person, { ...draft, text: '内容を訂正', time: '' }, '2026-09-30T03:00:00Z');
  assert.equal(edited.length, 2);
  assert.equal(edited[0].createdAt, timestamp);
  assert.equal(edited[0].updatedAt, '2026-09-30T03:00:00Z');
  assert.equal(edited[0].time, '');
  assert.deepEqual(edited[1], person.events[1]);
  assert.equal(person.events[0].text, draft.text);
});

test('saving a profile retains remotely added events; saving an event retains remote profile edits', () => {
  const base = { id: 'p1', name: '田中さん', photos: ['face.jpg'] };
  const events = upsertEvent(base, draft, timestamp);
  const savedProfile = mergeItem(base, { ...base, events }, { description: '説明を追加' });
  assert.deepEqual(savedProfile.events, events);
  const savedEvent = mergeItem(base, { ...base, name: '田中 太郎さん' }, { events });
  assert.equal(savedEvent.name, '田中 太郎さん');
  assert.deepEqual(savedEvent.photos, ['face.jpg']);
});

test('retry after a lost response does not duplicate events; competing updates do not overwrite', () => {
  const base = { id: 'p1' };
  const candidate = { events: upsertEvent(base, draft, timestamp) };
  const saved = mergeItem(base, base, candidate);
  const retried = mergeItem(base, saved, candidate);
  assert.deepEqual(retried.events, saved.events);
  const concurrent = { events: upsertEvent(base, { ...draft, id: 'other', text: '別端末から追加' }, timestamp) };
  assert.throws(() => mergeItem(base, saved, concurrent), { code: 'RECORD_CONFLICT' });
  assert.equal(saved.events.length, 1);
});
