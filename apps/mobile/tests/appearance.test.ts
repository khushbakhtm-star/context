import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAppearanceMode, resolveAppearanceMode } from '../src/theme';

test('appearance follows system changes only when system mode is selected', () => {
  assert.equal(resolveAppearanceMode('system', 'dark'), 'dark');
  assert.equal(resolveAppearanceMode('system', 'light'), 'light');
  assert.equal(resolveAppearanceMode('dark', 'light'), 'dark');
  assert.equal(resolveAppearanceMode('light', 'dark'), 'light');
  assert.equal(resolveAppearanceMode('system', null), 'light');
});

test('missing or malformed stored appearance preferences safely fall back to the system', () => {
  for (const value of [null, undefined, 'other', 5, {}, true]) {
    assert.equal(normalizeAppearanceMode(value), 'system');
  }
  assert.equal(normalizeAppearanceMode('light'), 'light');
  assert.equal(normalizeAppearanceMode('dark'), 'dark');
  assert.equal(normalizeAppearanceMode('system'), 'system');
});
