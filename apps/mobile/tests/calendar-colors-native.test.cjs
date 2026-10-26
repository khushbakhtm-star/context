const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFossManifest } = require('../scripts/prepare-fdroid.cjs');
const { SOURCE_ROOTS } = require('../scripts/prune-wear-sources.cjs');
const root = path.resolve(__dirname, '..');
const moduleRoot = path.join(root, 'modules/context-calendar-colors');

test('calendar color module remains a standalone Android source module in the F-Droid build', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const foss = createFossManifest(manifest);
  assert.ok(!foss.expo.autolinking.exclude.includes('context-calendar-colors'));
  assert.ok(SOURCE_ROOTS.every((relative) => !'modules/context-calendar-colors'.startsWith(relative)));
  const config = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'expo-module.config.json'), 'utf8'));
  assert.deepEqual(config.platforms, ['android']);
  assert.deepEqual(config.android.modules, ['expo.modules.contextcalendarcolors.ContextCalendarColorsModule']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(moduleRoot, 'package.json'), 'utf8')).license, 'MIT');
  const gradle = fs.readFileSync(path.join(moduleRoot, 'android/build.gradle'), 'utf8');
  assert.match(gradle, /expo-module-gradle-plugin/);
  assert.doesNotMatch(gradle, /implementation|com\.google|repositories/);
});

test('calendar color module adds no permission and exposes only a bounded read operation off the UI thread', () => {
  const manifest = fs.readFileSync(path.join(moduleRoot, 'android/src/main/AndroidManifest.xml'), 'utf8');
  assert.doesNotMatch(manifest, /uses-permission|service|provider|receiver/);
  const native = fs.readFileSync(path.join(moduleRoot, 'android/src/main/java/expo/modules/contextcalendarcolors/ContextCalendarColorsModule.kt'), 'utf8');
  assert.match(native, /checkSelfPermission\(Manifest\.permission\.READ_CALENDAR\)/);
  assert.match(native, /runOnQueue\(Queues\.DEFAULT\)/);
  assert.match(native, /\?\.use\s*\{\s*cursor\s*->/);
  assert.match(native, /ids\.toTypedArray\(\)/);
  assert.match(native, /MAX_ROWS/);
  assert.doesNotMatch(native, /contentResolver\.(?:insert|update|delete)|requestPermissions|Log\.|println\(/);
});
