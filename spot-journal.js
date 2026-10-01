'use strict';

(function exposeSpotJournal(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.kmapSpotJournal = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function dateTimeFields(dateValue, timeValue, required = false) {
    const date = String(dateValue || '').trim();
    const time = String(timeValue || '').trim();
    if (!date && !required && !time) return { date: '', time: '' };
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000')
      || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error('日付を正しく入力してください。');
    }
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw new Error('時刻は00:00〜23:59で入力してください。');
    }
    return { date, time };
  }

  function recordedFields(spot = {}) {
    // Explicitly empty dates stay unknown. Never use an edit as the initial record date.
    if (Object.hasOwn(spot, 'recordedDate')) {
      return { date: spot.recordedDate || '', time: spot.recordedTime || '' };
    }
    const created = new Date(spot.createdAt || '');
    if (Number.isNaN(created.getTime())) return { date: '', time: '' };
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(created).map(({ type, value }) => [type, value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  }

  function dateLabel(entry) {
    if (!entry.date) return '日時未記録';
    return `${entry.date.replaceAll('-', '.')}${entry.time ? ` ${entry.time}` : ''}`;
  }

  function additionLabel(entry) {
    return `${entry.date.replaceAll('-', '.')} 追記${entry.time ? ` · ${entry.time}` : ''}`;
  }

  function additionFields(draft) {
    const fields = dateTimeFields(draft.date, draft.time, true);
    const text = String(draft.text || '').trim();
    if (!text) throw new Error('追記の内容を入力してください。');
    return { ...fields, text };
  }

  function upsertAddition(spot, draft, timestamp = new Date().toISOString()) {
    if (!draft.id) throw new Error('追記のIDがありません。');
    const fields = additionFields(draft);
    const additions = Array.isArray(spot.additions) ? spot.additions : [];
    const existing = additions.find((entry) => entry.id === draft.id);
    const saved = {
      ...existing, ...fields, id: draft.id,
      createdAt: existing?.createdAt || timestamp, updatedAt: timestamp,
    };
    return existing
      ? additions.map((entry) => entry.id === draft.id ? saved : entry)
      : [...additions, saved];
  }

  function additionsFor(spot = {}) {
    return [...(Array.isArray(spot.additions) ? spot.additions : [])].sort((a, b) => (
      `${b.date}T${b.time || ''}`.localeCompare(`${a.date}T${a.time || ''}`)
      || String(a.id).localeCompare(String(b.id))
    ));
  }

  function searchText(spot) {
    return [dateLabel(recordedFields(spot)), ...additionsFor(spot)
      .flatMap((entry) => [entry.text, entry.date, additionLabel(entry)])].join(' ');
  }

  return { dateTimeFields, recordedFields, dateLabel, additionLabel, additionFields, upsertAddition, additionsFor, searchText };
}));
