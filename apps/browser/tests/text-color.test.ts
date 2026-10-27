import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveTextColor } from '../src/text-color';

test('formatting glyph follows the selected cell computed default in dark, light and solid fill contexts', () => {
  assert.equal(effectiveTextColor(undefined, 'rgb(238, 238, 238)'), '#EEEEEE');
  assert.equal(effectiveTextColor(undefined, 'rgb(36, 36, 36)'), '#242424');
  assert.equal(effectiveTextColor(undefined, 'rgb(17, 17, 17)'), '#111111');
  assert.equal(effectiveTextColor(undefined, '#eee'), '#EEEEEE');
  assert.equal(effectiveTextColor('#abcDEF', 'rgb(238, 238, 238)'), '#ABCDEF');
  assert.equal(effectiveTextColor('url(invalid)', 'rgb(256, 0, 0)'), '#242424');
});
