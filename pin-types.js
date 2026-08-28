'use strict';

// 保存済みデータの category は移行せず、表示だけを5種類へ束ねる。
// これにより、古い分類名やユーザーが追記した内容を失わない。
(function exposePinTypes(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.kmapPinTypes = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const TYPES = {
    memo: { id: 'memo', icon: '📍', label: 'メモ', category: 'メモ', color: '#d9480f' },
    shop: { id: 'shop', icon: '🛖', label: 'お店', category: 'お店', color: '#9c36b5' },
    facility: { id: 'facility', icon: '🏤', label: '公共施設', category: '公共施設', color: '#1864ab' },
    shrine: { id: 'shrine', icon: '⛩️', label: '寺社仏閣', category: '寺社仏閣', color: '#a61e4d' },
    nature: { id: 'nature', icon: '❇️', label: '自然スポット', category: '自然スポット', color: '#087f5b' },
  };

  const SPOT_ALIASES = {
    'お店': 'shop',
    '施設': 'facility',
    '公共施設': 'facility',
    '公民館': 'facility',
    '神社仏閣': 'shrine',
    '寺社仏閣': 'shrine',
    '自然': 'nature',
    '自然スポット': 'nature',
    '集落': 'memo',
    'その他': 'memo',
    'メモ': 'memo',
  };

  function typeIdFor(kind, category) {
    if (kind === 'notes') return 'memo';
    return SPOT_ALIASES[category] || 'memo';
  }

  function typeFor(kind, category) {
    return TYPES[typeIdFor(kind, category)];
  }

  function formCategories(kind) {
    const ids = kind === 'notes'
      ? ['memo']
      : ['memo', 'shop', 'facility', 'shrine', 'nature'];
    return ids.map((id) => TYPES[id]);
  }

  function activeItems(items) {
    return items.filter((item) => !item.archivedAt);
  }

  return { TYPES, typeIdFor, typeFor, formCategories, activeItems };
}));
