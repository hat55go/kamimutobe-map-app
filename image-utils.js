'use strict';

// Chrome が直接読めない HEIC/HEIF は、同梱した heic2any で JPEG にしてから
// 既存の縮小処理へ渡す。通常の JPEG/PNG/WebP はブラウザ標準機能だけを使う。
(function exposeImageUtils(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.kmapImages = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const HEIC_PATTERN = /\.(heic|heif)$/i;
  let converterPromise = null;

  function isHeicFile(file) {
    const type = String(file?.type || '').toLowerCase();
    return type.includes('heic') || type.includes('heif') || HEIC_PATTERN.test(file?.name || '');
  }

  function loadHeicConverter() {
    if (typeof root.heic2any === 'function') return Promise.resolve(root.heic2any);
    if (converterPromise) return converterPromise;

    converterPromise = new Promise((resolve, reject) => {
      const script = root.document.createElement('script');
      script.src = './vendor/heic2any.min.js';
      script.onload = () => {
        if (typeof root.heic2any === 'function') resolve(root.heic2any);
        else reject(new Error('HEIC変換機能を初期化できませんでした'));
      };
      script.onerror = () => reject(new Error('HEIC変換機能を読み込めませんでした'));
      root.document.head.appendChild(script);
    });
    return converterPromise;
  }

  async function browserReadableBlob(file) {
    if (!isHeicFile(file)) return file;
    try {
      const convert = await loadHeicConverter();
      const result = await convert({ blob: file, toType: 'image/jpeg', quality: 0.9 });
      const blob = Array.isArray(result) ? result[0] : result;
      if (!(blob instanceof Blob)) throw new Error('変換結果が画像ではありません');
      return blob;
    } catch (err) {
      const friendly = new Error(
        'HEIC写真を変換できませんでした。写真をJPEGで書き出してから、もう一度選択してください。',
      );
      friendly.cause = err;
      throw friendly;
    }
  }

  async function compressImage(file) {
    const source = await browserReadableBlob(file);
    let bitmap;
    try {
      bitmap = await root.createImageBitmap(source, { imageOrientation: 'from-image' });
    } catch (err) {
      const friendly = new Error(
        `「${file?.name || '選択した画像'}」を読み込めませんでした。JPEG、PNG、WebP、HEICの写真を選択してください。`,
      );
      friendly.cause = err;
      throw friendly;
    }

    try {
      const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
      const canvas = root.document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob) throw new Error('JPEGへの変換結果が空でした');
      return blob;
    } finally {
      bitmap.close();
    }
  }

  return { isHeicFile, browserReadableBlob, compressImage };
}));
