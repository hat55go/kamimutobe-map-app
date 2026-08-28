'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isHeicFile } = require('../image-utils.js');

test('HEICとHEIFを拡張子またはMIME typeで判定する', () => {
  assert.equal(isHeicFile({ name: 'IMG_0117.HEIC', type: '' }), true);
  assert.equal(isHeicFile({ name: 'photo', type: 'image/heif' }), true);
  assert.equal(isHeicFile({ name: 'photo.jpg', type: 'image/jpeg' }), false);
});
