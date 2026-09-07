'use strict';

// 人物タグはIDを正本にしつつ、旧「会った人」の文字列も失わないための純粋関数群。
// ブラウザと Node の単体テストの両方から利用する。
(function exposePeopleDirectory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.kmapPeople = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ja-JP');
  }

  function uniqueStrings(values = []) {
    const seen = new Set();
    return values.map((value) => String(value || '').trim()).filter((value) => {
      const key = normalizeName(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function parseNames(value) {
    if (Array.isArray(value)) return uniqueStrings(value);
    return uniqueStrings(String(value || '').split(/[,、\n]/));
  }

  function activePeople(people = []) {
    return people.filter((person) => person && !person.archivedAt);
  }

  function editableTags(record = {}, people = []) {
    const byId = new Map(people.map((person) => [String(person.id), person]));
    const byName = new Map(activePeople(people).map((person) => [normalizeName(person.name), person]));
    const selectedIds = [];
    const unmatched = [];
    const ids = uniqueStrings(record.peopleIds || []);
    const names = parseNames(record.people || []);

    ids.forEach((id, index) => {
      const person = byId.get(id);
      if (person) selectedIds.push(id);
      else if (names[index]) unmatched.push(names[index]);
    });

    names.slice(ids.length).forEach((name) => {
      const match = byName.get(normalizeName(name));
      if (match) selectedIds.push(String(match.id));
      else unmatched.push(name);
    });

    // 旧データはpeopleIdsを持たないため、文字列から現行名簿へ安全に結び付ける。
    if (!ids.length) {
      selectedIds.length = 0;
      unmatched.length = 0;
      names.forEach((name) => {
        const match = byName.get(normalizeName(name));
        if (match) selectedIds.push(String(match.id));
        else unmatched.push(name);
      });
    }

    return {
      selectedIds: [...new Set(selectedIds)],
      unmatchedNames: uniqueStrings(unmatched),
    };
  }

  function buildTagData(selectedIds = [], otherNames = '', people = []) {
    const byId = new Map(people.map((person) => [String(person.id), person]));
    const peopleIds = [...new Set(selectedIds.map(String))].filter((id) => byId.has(id));
    const selectedNames = peopleIds.map((id) => String(byId.get(id).name || '').trim()).filter(Boolean);
    const extras = parseNames(otherNames)
      .filter((name) => !selectedNames.some((selected) => normalizeName(selected) === normalizeName(name)));
    return { peopleIds, people: uniqueStrings([...selectedNames, ...extras]) };
  }

  function resolveRecordPeople(record = {}, people = []) {
    const byId = new Map(people.map((person) => [String(person.id), person]));
    const byName = new Map(people.map((person) => [normalizeName(person.name), person]));
    const ids = uniqueStrings(record.peopleIds || []);
    const names = parseNames(record.people || []);
    const resolved = [];
    const seenIds = new Set();
    const seenNames = new Set();

    function addPerson(person) {
      const id = String(person.id);
      if (seenIds.has(id)) return;
      seenIds.add(id);
      seenNames.add(normalizeName(person.name));
      resolved.push({ id, name: String(person.name || '').trim(), registered: true });
    }

    function addName(name) {
      const key = normalizeName(name);
      if (!key || seenNames.has(key)) return;
      const person = byName.get(key);
      if (person) addPerson(person);
      else {
        seenNames.add(key);
        resolved.push({ id: null, name, registered: false });
      }
    }

    ids.forEach((id, index) => {
      const person = byId.get(id);
      if (person) addPerson(person);
      else if (names[index]) addName(names[index]);
    });
    names.slice(ids.length).forEach(addName);
    if (!ids.length) names.forEach(addName);
    return resolved.filter((tag) => tag.name);
  }

  function recordMatchesPerson(record = {}, person = {}) {
    const id = String(person.id || '');
    if (id && (record.peopleIds || []).map(String).includes(id)) return true;
    const personName = normalizeName(person.name);
    return !!personName && parseNames(record.people || [])
      .some((name) => normalizeName(name) === personName);
  }

  function logSortKey(kind, item) {
    if (kind === 'notes' && item.date) return `${item.date}T23:59:59`;
    return item.updatedAt || item.createdAt || '';
  }

  function logsForPerson(person, notes = [], spots = []) {
    return [
      ...notes.map((item) => ({ kind: 'notes', item })),
      ...spots.map((item) => ({ kind: 'spots', item })),
    ]
      .filter(({ item }) => !item.archivedAt && recordMatchesPerson(item, person))
      .sort((a, b) => logSortKey(b.kind, b.item).localeCompare(logSortKey(a.kind, a.item)));
  }

  return {
    normalizeName,
    parseNames,
    activePeople,
    editableTags,
    buildTagData,
    resolveRecordPeople,
    recordMatchesPerson,
    logsForPerson,
  };
}));
