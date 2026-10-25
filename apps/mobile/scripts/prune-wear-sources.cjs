const fs = require('node:fs');
const path = require('node:path');
const { digest, inside, safeFile } = require('./fdroid-source-inputs.cjs');

const SOURCE_ROOTS = ['wear-support', 'modules/context-wear', 'plugins/with-context-wear.cjs'];

function sourceFiles(root) {
  const files = [];
  const walk = (relative) => {
    const target = path.resolve(root, relative);
    if (!fs.existsSync(target)) return;
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error(`Wear source input must not be a link: ${relative}`);
    if (stat.isDirectory()) {
      if (!inside(fs.realpathSync(root), fs.realpathSync(target))) throw new Error('Wear source directory leaves the build checkout.');
      for (const name of fs.readdirSync(target)) walk(path.posix.join(relative, name));
    } else {
      safeFile(root, target); files.push(relative);
    }
  };
  for (const relative of SOURCE_ROOTS) walk(relative);
  return files.sort();
}

function pruneWearSources(root, inventory) {
  const real = fs.realpathSync(root);
  if (JSON.parse(fs.readFileSync(path.join(real, 'package.json'), 'utf8')).name !== 'context-mobile') {
    throw new Error('Wear source pruning requires a Context mobile source checkout.');
  }
  inventory ??= JSON.parse(fs.readFileSync(path.join(real, 'fdroid', 'wear-source-inputs.json'), 'utf8'));
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.files)) throw new Error('Invalid reviewed Wear source inventory.');
  const expected = new Map();
  for (const item of inventory.files) {
    if (!SOURCE_ROOTS.some((base) => item.path === base || item.path.startsWith(base + '/')) ||
        item.path.includes('..') || expected.has(item.path) || !/^[a-f0-9]{64}$/.test(item.sha256)) {
      throw new Error('Invalid reviewed Wear source path/hash.');
    }
    expected.set(item.path, item);
  }
  const removed = [];
  // Verify every remaining file before removing any file. A changed or newly added
  // proprietary build input must stop preparation rather than bypass the scanner.
  for (const relative of sourceFiles(real)) {
    const item = expected.get(relative);
    const target = safeFile(real, path.join(real, relative));
    if (!item || digest(fs.readFileSync(target)) !== item.sha256) {
      throw new Error(`Unreviewed Wear source removal input: ${relative}`);
    }
    removed.push({ path: relative, sha256: item.sha256, reason: 'Optional Google Play services Wear companion; excluded from the F-Droid source build.' });
  }
  for (const item of removed) fs.unlinkSync(safeFile(real, path.join(real, item.path)));
  return removed;
}

module.exports = { SOURCE_ROOTS, sourceFiles, pruneWearSources };
