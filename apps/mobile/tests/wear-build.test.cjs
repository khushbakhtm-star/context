const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { SOURCE_ROOTS, sourceFiles, pruneWearSources } = require('../scripts/prune-wear-sources.cjs');
const root = path.resolve(__dirname, '..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'context-wear-test-'));
  t.after(() => {
    assert.equal(path.dirname(directory), fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(directory), /^context-wear-test-/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function plugin() {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'plugins/with-context-wear.cjs'), 'utf8'), {
    module, process, Buffer,
    require(name) {
      if (name === 'expo/config-plugins') return { withSettingsGradle: (_, callback) => callback,
        withDangerousMod: (_, callback) => callback };
      return require(name);
    },
  });
  return module.exports;
}

test('watch project generation carries its independent release identity, approved logo and native module', (t) => {
  const output = fixture(t);
  const project = plugin();
  const settings = project.includeWear('rootProject.name = "Context"\n');
  assert.equal(project.includeWear(settings), settings);
  assert.match(settings, /include ':wear'/);
  project.generateWear(root, output, { version: '0.9.0', android: { versionCode: 91 } });
  const gradle = fs.readFileSync(path.join(output, 'wear/build.gradle'), 'utf8');
  assert.match(gradle, /applicationId 'com\.context\.minuteledger'/);
  assert.match(gradle, /versionCode 100013 as int/);
  assert.match(gradle, /versionName "0\.1\.12"/);
  assert.deepEqual(JSON.parse(JSON.stringify(project.readWatchVersion(root))), { version: '0.1.12', versionCode: 100013 });
  project.generateWear(root, output, { version: '22.1.0', android: { versionCode: 500 } });
  assert.equal(fs.readFileSync(path.join(output, 'wear/build.gradle'), 'utf8'), gradle,
    'phone version changes cannot silently change the watch package identity');
  assert.match(gradle, /credentials\.json/);
  assert.match(gradle, /EAS_BUILD_WORKINGDIR/);
  assert.doesNotMatch(gradle, /debug\.keystore|signingConfigs\.debug|com\.facebook\.react/);
  assert.equal(hash(fs.readFileSync(path.join(output, 'wear/src/main/res/drawable-nodpi/context_logo.png'))),
    hash(fs.readFileSync(path.join(root, 'assets/context-app-logo.png'))));
  const manifest = fs.readFileSync(path.join(output, 'wear/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android\.hardware\.type\.watch/);
  assert.match(manifest, /<uses-permission android:name="android\.permission\.RECORD_AUDIO"\s*\/>/);
  assert.match(manifest, /<queries>[\s\S]*android\.speech\.RecognitionService[\s\S]*<\/queries>/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'modules/context-wear/android/src/main/AndroidManifest.xml'), 'utf8'),
    /RECORD_AUDIO|RecognitionService/, 'watch microphone permission must not be added to the phone bridge');
  assert.doesNotThrow(() => project.generateWear(root, output, {}), 'phone metadata is not a watch version source');
});

test('missing or malformed independent watch metadata fails before creating any generated watch output', (t) => {
  const input = fixture(t); const output = fixture(t); const project = plugin();
  fs.mkdirSync(path.join(input, 'wear-support/watch'), { recursive: true });
  const file = path.join(input, 'wear-support/watch/version.json');
  assert.throws(() => project.generateWear(input, output), /independent version/);
  for (const content of ['{', '{}', '[]', JSON.stringify({ version: '0.1.9', versionCode: 9 }),
    JSON.stringify({ version: '0.1.9', versionCode: 100010.5 }), JSON.stringify({ version: '0.1.9', versionCode: 2100000001 }),
    JSON.stringify({ version: '0.1.9"; malicious()', versionCode: 100010 }),
    JSON.stringify({ version: '0.1.9', versionCode: 100010, phoneCode: 18 })]) {
    fs.writeFileSync(file, content);
    assert.throws(() => project.generateWear(input, output), /watch version|watch versionCode|independent watch|reserved Android/);
    assert.equal(fs.existsSync(path.join(output, 'wear')), false);
  }
});

test('watch cloud profile retains remote signing and uploads only the native watch APK', () => {
  const profile = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8')).build['wear-preview'];
  assert.equal(profile.credentialsSource, 'remote');
  assert.equal(profile.env.CONTEXT_WEAR_BUILD, '1');
  assert.equal(profile.android.gradleCommand, ':wear:test :wear:assembleRelease');
  assert.equal(profile.android.applicationArchivePath, 'android/wear/build/outputs/apk/release/*.apk');
});

test('cloud upload ignores generated native roots without excluding the nested phone bridge', () => {
  const ignore = fs.readFileSync(path.join(root, '.easignore'), 'utf8').replaceAll('\r\n', '\n');
  assert.match(ignore, /^\/android\/$/m);
  assert.match(ignore, /^\/ios\/$/m);
  assert.doesNotMatch(ignore, /^(?:\*\*\/)?android\/$/m,
    'an unanchored android directory rule removes modules/context-wear/android from the cloud upload');
  assert.doesNotMatch(ignore, /^(?:\*\*\/)?ios\/$/m);
});

test('watch height budgets preserve the ledger and fixed editor actions on small round screens', () => {
  const directory = path.join(root, 'wear-support/watch/src/main/java/com/context/minuteledger/wear');
  const layout = fs.readFileSync(path.join(directory, 'WatchLayout.kt'), 'utf8');
  const constants = Object.fromEntries([...layout.matchAll(/const val ([A-Z_]+) = (\d+)/g)]
    .map((match) => [match[1], Number(match[2])]));
  for (const height of [198, 220, 224]) {
    const ledger = height - constants.TOP - constants.HEADER - constants.STATUS;
    assert.ok(ledger >= 2 * constants.MINUTE, `${height}dp shows at least two full minute rows`);
    const editor = height - constants.TOP - constants.EDITOR_BOTTOM - constants.ACTIONS;
    assert.ok(editor >= constants.TITLE + constants.TEXT_FIELD + constants.INPUT_TOOLS,
      `${height}dp editor reserves real text space`);
  }
  assert.ok(100 - constants.TOP - constants.EDITOR_BOTTOM - constants.ACTIONS > 0,
    'the IME-resized dialog preserves a scrolling body and fixed Save actions');
  const activity = fs.readFileSync(path.join(directory, 'MinuteActivity.kt'), 'utf8');
  assert.match(activity, /val scrolling = android\.widget\.ScrollView/);
  assert.match(activity, /body\.addView\(input, LinearLayout\.LayoutParams\(-1, dp\(WatchLayout\.TEXT_FIELD\)\)\)/);
  assert.doesNotMatch(activity, /Use watch edit|Keep phone entry|store\.retry\(/,
    'conflict resolution stays on the phone so the original receipt is resolved atomically');
});

test('F-Droid Wear source pruning verifies all hashes before deleting exact reviewed files', (t) => {
  const directory = fixture(t);
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'context-mobile' }));
  fs.mkdirSync(path.join(directory, 'wear-support/watch'), { recursive: true });
  const gradle = path.join(directory, 'wear-support/watch/build.gradle');
  fs.writeFileSync(gradle, 'reviewed optional Wear build');
  const outside = path.join(directory, 'phone.txt');
  fs.writeFileSync(outside, 'phone source');
  const inventory = { schemaVersion: 1, files: [{ path: 'wear-support/watch/build.gradle',
    sha256: hash(Buffer.from('reviewed optional Wear build')) }] };
  const unreviewed = path.join(directory, 'wear-support/new.kt');
  fs.writeFileSync(unreviewed, 'new source');
  assert.throws(() => pruneWearSources(directory, inventory), /Unreviewed/);
  assert.equal(fs.existsSync(gradle), true, 'no partial removal before an inventory mismatch');
  fs.unlinkSync(unreviewed);
  fs.writeFileSync(gradle, 'changed dependency');
  assert.throws(() => pruneWearSources(directory, inventory), /Unreviewed/);
  fs.writeFileSync(gradle, 'reviewed optional Wear build');
  assert.equal(pruneWearSources(directory, inventory).length, 1);
  assert.equal(fs.existsSync(gradle), false);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'phone source');
  assert.equal(pruneWearSources(directory, inventory).length, 0, 'idempotent after exact files are removed');
  assert.throws(() => pruneWearSources(directory, { schemaVersion: 1,
    files: [{ path: '../phone.txt', sha256: hash(Buffer.from('phone source')) }] }), /Invalid/);
});

test('reviewed inventory removes the complete optional native SDK source graph in a fixture', (t) => {
  const directory = fixture(t);
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'context-mobile' }));
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'fdroid/wear-source-inputs.json'), 'utf8'));
  assert.deepEqual(sourceFiles(root), inventory.files.map((file) => file.path));
  for (const item of inventory.files) assert.equal(hash(fs.readFileSync(path.join(root, item.path))), item.sha256, item.path);
  for (const relative of SOURCE_ROOTS) {
    fs.mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
    fs.cpSync(path.join(root, relative), path.join(directory, relative), { recursive: true });
  }
  fs.writeFileSync(path.join(directory, 'phone-source.txt'), 'retained phone implementation');
  assert.equal(pruneWearSources(directory, inventory).length, inventory.files.length);
  assert.deepEqual(sourceFiles(directory), []);
  assert.equal(fs.readFileSync(path.join(directory, 'phone-source.txt'), 'utf8'), 'retained phone implementation');
});
