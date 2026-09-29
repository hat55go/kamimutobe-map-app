'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  editableTags, buildTagData, resolveRecordPeople, logsForPerson,
  membershipTagsFor, updateMembershipTags,
} = require('../people-directory.js');

const people = [
  { id: 'p1', name: '田中さん' },
  { id: 'p2', name: '佐藤さん' },
];

test('旧「会った人」の名前を名簿IDへ結び付け、未登録名を残す', () => {
  assert.deepEqual(editableTags({ people: ['田中さん', '未登録さん'] }, people), {
    selectedIds: ['p1'],
    unmatchedNames: ['未登録さん'],
  });
});

test('membership tags are opt-in and independently selectable for legacy people', () => {
  assert.deepEqual(membershipTagsFor(people[0]), []);
  assert.deepEqual(updateMembershipTags(people[0], ['council-executive']), ['council-executive']);
  const tags = updateMembershipTags(people[0], ['council-member', 'council-executive', 'council-member']);
  assert.deepEqual(membershipTagsFor({ membershipTags: tags }).map((tag) => tag.label), [
    '協議会メンバー', '協議会執行部メンバー',
  ]);
  assert.equal(people[0].membershipTags, undefined);
});

test('unchecking membership tags preserves events, photos, and unrelated tags', () => {
  const { mergeItem } = require('../record-merge.js');
  const person = {
    id: 'p1', name: '田中さん', photos: ['face.jpg'],
    events: [{ id: 'e1', date: '2026-09-29', time: '14:30', text: '訪問' }],
    membershipTags: ['council-member', 'council-executive', 'future-tag'],
  };
  const removedOne = updateMembershipTags(person, ['council-member']);
  assert.deepEqual(removedOne, ['future-tag', 'council-member']);
  const saved = mergeItem(person, person, { membershipTags: updateMembershipTags(person, []) });
  assert.deepEqual(saved.membershipTags, ['future-tag']);
  assert.deepEqual(saved.events, person.events);
  assert.deepEqual(saved.photos, person.photos);
  assert.equal(saved.name, person.name);
  assert.deepEqual(person.membershipTags, ['council-member', 'council-executive', 'future-tag']);
});

test('人物タグ保存時にIDと表示名を併記して検索互換性を保つ', () => {
  assert.deepEqual(buildTagData(['p2', 'p1'], '未登録さん、田中さん', people), {
    peopleIds: ['p2', 'p1'],
    people: ['佐藤さん', '田中さん', '未登録さん'],
  });
});

test('名簿で改名してもIDで現在名を表示し、古い名前を重複表示しない', () => {
  const renamed = [{ id: 'p1', name: '田中 太郎さん' }];
  assert.deepEqual(
    resolveRecordPeople({ peopleIds: ['p1'], people: ['田中さん'] }, renamed),
    [{ id: 'p1', name: '田中 太郎さん', registered: true }],
  );
});

test('名簿で非表示にした人物も過去の記録を編集しただけでは外さない', () => {
  const archivedPeople = [{ id: 'p1', name: '田中さん', archivedAt: '2026-09-01T00:00:00Z' }];
  const editable = editableTags({ peopleIds: ['p1'], people: ['田中さん'] }, archivedPeople);
  assert.deepEqual(editable, { selectedIds: ['p1'], unmatchedNames: [] });
  assert.deepEqual(buildTagData(editable.selectedIds, '', archivedPeople), {
    peopleIds: ['p1'], people: ['田中さん'],
  });
});

test('人物の直近ログをメモと場所の両方から新しい順に集める', () => {
  const logs = logsForPerson(
    people[0],
    [{ id: 'n1', title: '訪問', date: '2026-09-01', peopleIds: ['p1'] }],
    [{ id: 's1', title: '公民館', updatedAt: '2026-09-02T09:00:00Z', people: ['田中さん'] }],
  );
  assert.deepEqual(logs.map(({ kind, item }) => `${kind}:${item.id}`), ['spots:s1', 'notes:n1']);
});
