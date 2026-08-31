'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  typeIdFor, formCategories, addChoices, activeItems,
} = require('../pin-types.js');

test('既存カテゴリをデータ変更なしで5種類へ束ねる', () => {
  assert.equal(typeIdFor('notes', '気づき'), 'memo');
  assert.equal(typeIdFor('spots', '集落'), 'memo');
  assert.equal(typeIdFor('spots', 'お店'), 'shop');
  assert.equal(typeIdFor('spots', '施設'), 'facility');
  assert.equal(typeIdFor('spots', '神社仏閣'), 'shrine');
  assert.equal(typeIdFor('spots', '寺社仏閣'), 'shrine');
  assert.equal(typeIdFor('spots', '自然'), 'nature');
});

test('新規メモと場所図鑑の入力先を混同しない', () => {
  assert.deepEqual(
    formCategories('notes').map((type) => type.category),
    ['メモ'],
  );
  assert.deepEqual(
    formCategories('spots').map((type) => type.category),
    ['お店', '公共施設', '寺社仏閣', '自然スポット'],
  );
  assert.deepEqual(
    addChoices().map(({ category, kind }) => [category, kind]),
    [
      ['メモ', 'notes'],
      ['お店', 'spots'],
      ['公共施設', 'spots'],
      ['寺社仏閣', 'spots'],
      ['自然スポット', 'spots'],
    ],
  );
});

test('既存の場所メモは編集時だけ選択肢を維持する', () => {
  assert.deepEqual(
    formCategories('spots', { includeMemoSpot: true }).map((type) => type.category),
    ['メモ', 'お店', '公共施設', '寺社仏閣', '自然スポット'],
  );
});

test('非表示記録を通常表示から除外する', () => {
  assert.deepEqual(
    activeItems([{ id: 'shown' }, { id: 'hidden', archivedAt: '2026-08-28T00:00:00Z' }]),
    [{ id: 'shown' }],
  );
});
