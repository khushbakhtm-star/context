const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

test('generated watch package registers a permission-protected Tile and retains its static preview resources', (t) => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'plugins/with-context-wear.cjs'), 'utf8'), { module, process, Buffer,
    require(name) { if (name === 'expo/config-plugins') return { withSettingsGradle() {}, withDangerousMod() {} }; return require(name); } });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'context-tile-test-'));
  t.after(() => { assert.equal(path.dirname(directory), fs.realpathSync(os.tmpdir())); assert.match(path.basename(directory), /^context-tile-test-/); fs.rmSync(directory, { recursive: true, force: true }); });
  module.exports.generateWear(root, directory, JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo);
  const generated = path.join(directory, 'wear'); const manifest = fs.readFileSync(path.join(generated, 'src/main/AndroidManifest.xml'), 'utf8');
  const service = /<service\b(?=[^>]*android:name="\.ContextTileService")[\s\S]*?<\/service>/.exec(manifest)?.[0];
  assert.ok(service); assert.match(service, /android:exported="true"/);
  assert.match(service, /android:permission="com\.google\.android\.wearable\.permission\.BIND_TILE_PROVIDER"/);
  assert.match(service, /androidx\.wear\.tiles\.action\.BIND_TILE_PROVIDER/);
  assert.match(service, /androidx\.wear\.tiles\.PREVIEW[^>]*@drawable\/context_tile_preview/);
  assert.match(manifest, /<activity[^>]*android:name="\.MinuteActivity"[^>]*android:launchMode="singleTop"/);
  assert.ok(fs.existsSync(path.join(generated, 'src/main/res/drawable/context_tile_preview.xml')));
  assert.ok(fs.existsSync(path.join(generated, 'src/main/res/drawable-nodpi/context_logo.png')));
  const gradle = fs.readFileSync(path.join(generated, 'build.gradle'), 'utf8');
  assert.match(gradle, /androidx\.wear\.tiles:tiles:1\.6\.2/); assert.match(gradle, /androidx\.wear\.protolayout:protolayout:1\.4\.2/);
  assert.doesNotMatch(gradle, /androidx\.compose|protolayout-material3|tiles-renderer/);
});

test('the public Tile has no ledger/network/clock reads and uses an explicit Now request rather than a cached minute', () => {
  const source = fs.readFileSync(path.join(root, 'wear-support/watch/src/main/java/com/context/minuteledger/wear/ContextTileService.kt'), 'utf8');
  const layout = fs.readFileSync(path.join(root, 'wear-support/watch/src/main/java/com/context/minuteledger/wear/ContextTileLayout.kt'), 'utf8');
  assert.match(source, /MinuteActivity::class\.java\.name/);
  assert.match(layout, /const val ACTION_EXTRA = "com\.context\.minuteledger\.action"/);
  assert.match(layout, /const val RECORD_NOW = "com\.context\.minuteledger\.action\.RECORD_NOW"/);
  assert.match(layout, /\.setPackageName\(packageName\)\.setClassName\(activityClassName\)/);
  assert.equal((layout.match(/addKeyToExtraMapping/g) ?? []).length, 1);
  assert.doesNotMatch(source + layout, /WatchStore|WatchTransport|LocalDateTime|System\.currentTimeMillis|SharedPreferences|https?:\/\/|setFreshnessIntervalMillis/);
});

test('the Tile launches the current-minute capture through the same protected one-shot entry as the launcher', () => {
  const activity = fs.readFileSync(path.join(root, 'wear-support/watch/src/main/java/com/context/minuteledger/wear/MinuteActivity.kt'), 'utf8');
  const launch = fs.readFileSync(path.join(root, 'wear-support/watch/src/main/java/com/context/minuteledger/wear/LaunchPolicy.kt'), 'utf8');
  assert.match(activity, /intent\.getStringExtra\(LAUNCH_ACTION\) == RECORD_NOW/);
  assert.match(activity, /LaunchPolicy\.freshEntry\(savedInstanceState != null, requestsRecordNow\(intent\)\)/);
  assert.match(launch, /LaunchTrigger\.LAUNCHER_OR_TILE -> if \(state\.protectsEditing\) LaunchDecision\(false, true\)\s*else LaunchDecision\(true, false, startDictation = true\)/);
});
