import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveTextColor, noteColorOnFill } from '../src/text-color';

test('automatic browser note contrast keeps dark custom hex colors readable and uses black on light fills', () => {
  for (const color of ['#123456', '#000000', '#333333']) assert.equal(noteColorOnFill(color), '#FFFFFF');
  for (const color of ['#FFFFFF', '#E6E6E6', '#FFFF00']) assert.equal(noteColorOnFill(color), '#000000');
});

test('formatting glyph follows the selected cell computed default in dark, light and solid fill contexts', () => {
  assert.equal(effectiveTextColor(undefined, 'rgb(238, 238, 238)'), '#EEEEEE');
  assert.equal(effectiveTextColor(undefined, 'rgb(36, 36, 36)'), '#242424');
  assert.equal(effectiveTextColor(undefined, 'rgb(17, 17, 17)'), '#111111');
  assert.equal(effectiveTextColor(undefined, '#eee'), '#EEEEEE');
  assert.equal(effectiveTextColor('#abcDEF', 'rgb(238, 238, 238)'), '#ABCDEF');
  assert.equal(effectiveTextColor('url(invalid)', 'rgb(256, 0, 0)'), '#242424');
});
