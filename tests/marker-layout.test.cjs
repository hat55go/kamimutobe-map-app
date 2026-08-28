'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('ピンは地図座標へ固定するabsolute配置を維持する', () => {
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const markerRule = css.match(/\.marker\s*\{([^}]*)\}/);

  assert.ok(markerRule, '.marker rule should exist');
  assert.match(markerRule[1], /position:\s*absolute\s*;/);
});

test('ピンは下端を座標にしてズーム中も滑らかに追従する', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

  assert.match(app, /anchor:\s*'bottom'/);
  assert.match(app, /subpixelPositioning:\s*true/);
});
