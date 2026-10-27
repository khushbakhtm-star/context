const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { STATE, digest, prepareInstalledSources } = require('../scripts/fdroid-source-inputs.cjs');

const root = path.resolve(__dirname, '..');
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'fdroid/source-inputs.json'), 'utf8'));
const names = ['expo-print', 'expo-sharing', 'expo-clipboard'];
const reviewed = inventory.packages.filter((entry) => names.includes(entry.name));

test('Print, Sharing and Clipboard use eight hash-reviewed unused inputs without changing source patches or the toolchain', () => {
  assert.equal(inventory.packages.length, 28);
  assert.equal(inventory.packages.reduce((count, entry) => count + entry.remove.length, 0), 109);
  assert.equal(inventory.packages.reduce((count, entry) => count + entry.patch.length, 0), 5);
  assert.deepEqual(reviewed.map((entry) => entry.name).sort(), [...names].sort());
  const lock = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  for (const entry of reviewed) {
    const location = fs.realpathSync(path.join(root, 'node_modules', entry.name));
    const actual = JSON.parse(fs.readFileSync(path.join(location, 'package.json'), 'utf8'));
    assert.equal(entry.version, actual.version);
    assert.equal(entry.license, 'MIT');
    assert.deepEqual(entry.repository, actual.repository);
    assert.ok(lock.includes(`  ${entry.name}@${entry.version}:\n    resolution: {integrity: ${entry.npmIntegrity}}`));
    assert.deepEqual(entry.patch, []);
    for (const file of entry.remove) assert.equal(digest(fs.readFileSync(path.join(location, file.path))), file.sha256);
  }
  assert.equal(reviewed.reduce((count, entry) => count + entry.remove.length, 0), 8);
  assert.equal(reviewed.flatMap((entry) => entry.remove).filter((entry) => entry.path.endsWith('.aar')).length, 3);
  assert.equal(reviewed.flatMap((entry) => entry.remove).filter((entry) => entry.path.endsWith('-sources.jar')).length, 3);
  assert.equal(reviewed.flatMap((entry) => entry.remove).filter((entry) => entry.path.endsWith('.tar.gz')).length, 2);
});

test('the eight reviewed removals run only on copied temporary fixtures and never change installed package bytes', (t) => {
  const temporary = fs.realpathSync(os.tmpdir());
  const staging = fs.realpathSync(fs.mkdtempSync(path.join(temporary, 'context-print-fdroid-')));
  t.after(() => {
    const target = fs.realpathSync(staging);
    assert.equal(path.dirname(target), temporary);
    assert.match(path.basename(target), /^context-print-fdroid-/);
    fs.rmSync(target, { recursive: true, force: true });
  });
  const originalEnvironment = { distribution: process.env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION, source: process.env.CONTEXT_FDROID_SOURCE_BUILD };
  process.env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION = 'fdroid';
  process.env.CONTEXT_FDROID_SOURCE_BUILD = '1';
  t.after(() => {
    if (originalEnvironment.distribution === undefined) delete process.env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION;
    else process.env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION = originalEnvironment.distribution;
    if (originalEnvironment.source === undefined) delete process.env.CONTEXT_FDROID_SOURCE_BUILD;
    else process.env.CONTEXT_FDROID_SOURCE_BUILD = originalEnvironment.source;
  });
  fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({ name: 'context-mobile',
    expo: { autolinking: { android: { buildFromSource: ['.*'] } } } }));
  const lock = 'reviewed temporary fixture lock\n';
  fs.writeFileSync(path.join(staging, 'pnpm-lock.yaml'), lock);
  fs.writeFileSync(path.join(staging, STATE), JSON.stringify({ root: staging, lockSha256: digest(Buffer.from(lock)) }));
  const originals = [];
  const fixturePaths = [];
  for (const entry of reviewed) {
    const source = fs.realpathSync(path.join(root, 'node_modules', entry.name));
    const destination = path.join(staging, 'node_modules/.pnpm', `${entry.name}@${entry.version}`, 'node_modules', entry.name);
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify({ name: entry.name, version: entry.version }));
    for (const input of entry.remove) {
      const from = path.join(source, input.path);
      const to = path.join(destination, input.path);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to); // Ordinary copies only: never a pnpm hardlink or junction.
      assert.equal(digest(fs.readFileSync(from)), input.sha256);
      originals.push({ path: from, sha256: input.sha256 });
      fixturePaths.push(to);
    }
  }
  const hermesRoot = path.join(staging, 'node_modules/.pnpm/hermes-compiler@1.0.0/node_modules/hermes-compiler');
  fs.mkdirSync(path.join(hermesRoot, 'hermesc/linux64-bin'), { recursive: true });
  fs.writeFileSync(path.join(hermesRoot, 'package.json'), JSON.stringify({ name: 'hermes-compiler', version: '1.0.0' }));
  const hermesBytes = Buffer.from('reviewed temporary compiler fixture');
  fs.writeFileSync(path.join(hermesRoot, 'hermesc/linux64-bin/hermesc'), hermesBytes);
  const fixtureInventory = { packages: reviewed,
    hermes: { package: 'hermes-compiler', version: '1.0.0', path: 'hermesc/linux64-bin/hermesc', sha256: digest(hermesBytes) } };
  const audit = prepareInstalledSources(staging, { inventory: fixtureInventory });
  assert.equal(audit.removed.length, 8);
  assert.deepEqual(audit.patched, []);
  for (const file of fixturePaths) assert.equal(fs.existsSync(file), false);
  for (const file of originals) assert.equal(digest(fs.readFileSync(file.path)), file.sha256, 'installed package file must remain untouched');
  fs.writeFileSync(fixturePaths[0], 'changed fixture publication');
  assert.throws(() => prepareInstalledSources(staging, { inventory: fixtureInventory }), /Unreviewed F-Droid removal input/);
  for (const file of originals) assert.equal(digest(fs.readFileSync(file.path)), file.sha256);
});
