'use strict';

// 追加・編集の保存直前に別端末の更新が入っても、既存内容を踏み潰さないための
// 三方向マージ。ブラウザと Node の単体テストの両方から利用する。
(function exposeRecordMerge(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.kmapRecordMerge = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((out, key) => {
        out[key] = canonical(value[key]);
        return out;
      }, {});
    }
    return value;
  }

  function same(a, b) {
    return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  }

  function mergePhotoRefs(baseRefs = [], latestRefs = [], candidateRefs = []) {
    const removed = new Set(baseRefs.filter((name) => !candidateRefs.includes(name)));
    const added = candidateRefs.filter((name) => !baseRefs.includes(name));
    const merged = latestRefs.filter((name) => !removed.has(name));
    for (const name of added) {
      if (!merged.includes(name)) merged.push(name);
    }
    return merged;
  }

  function conflictError(fields) {
    const err = new Error(
      `同じ項目が別の端末でも更新されています（${fields.join('、')}）。` +
      '既存内容を守るため保存を中止しました。画面を読み込み直して内容を確認してください。',
    );
    err.code = 'RECORD_CONFLICT';
    err.fields = fields;
    return err;
  }

  function mergeItem(base, latest, candidate) {
    if (!base) return { ...latest, ...candidate, id: latest.id };

    const merged = { ...latest };
    const conflicts = [];
    for (const [key, candidateValue] of Object.entries(candidate)) {
      if (key === 'id' || key === 'createdAt' || key === 'updatedAt') continue;
      const baseValue = base[key];
      const latestValue = latest[key];
      if (same(candidateValue, baseValue)) continue;

      if (key === 'photos') {
        merged.photos = mergePhotoRefs(baseValue || [], latestValue || [], candidateValue || []);
        continue;
      }

      const remoteChanged = !same(latestValue, baseValue);
      if (remoteChanged && !same(latestValue, candidateValue)) {
        conflicts.push(key);
      } else {
        merged[key] = candidateValue;
      }
    }

    if (conflicts.length) throw conflictError(conflicts);
    merged.id = latest.id;
    merged.updatedAt = new Date().toISOString();
    return merged;
  }

  function assertSafeDelete(base, latest) {
    if (base && !same(base, latest)) throw conflictError(['削除対象']);
  }

  function parseApiPath(path) {
    const match = path.match(/^\/api\/(notes|spots)(?:\/([^/]+))?$/);
    if (!match) throw new Error(`不正なパス: ${path}`);
    return { kind: match[1], id: match[2] ? decodeURIComponent(match[2]) : null };
  }

  return { same, mergeItem, mergePhotoRefs, assertSafeDelete, parseApiPath };
}));
