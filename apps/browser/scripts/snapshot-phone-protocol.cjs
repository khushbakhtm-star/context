// A portable Site checkout includes every reviewed shared build input. Run from
// the Context monorepo to refresh this exact, hash-recorded source snapshot.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const mobile = path.resolve(root, '../mobile');
const files = ['utils/time.ts', 'utils/cell-format.ts', 'utils/calendar-cell-color.ts',
  'utils/calendar-minute-log.ts', 'utils/calendar-description.ts', 'sync/codec.ts',
  'utils/date-selection.ts', 'utils/spreadsheet-paste.ts', 'sync/types.ts', 'types.ts'];
const manifest = files.map((file) => {
  const bytes = Buffer.from(fs.readFileSync(path.join(mobile, 'src', file), 'utf8').replace(/\r\n/g, '\n'));
  const target = path.join(root, 'shared', file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  return { path: file, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
});
fs.writeFileSync(path.join(root, 'shared', 'source-manifest.json'), JSON.stringify({
  version: 1, source: 'Context mobile 0.1.17 reviewed source', lineEndings: 'LF', files: manifest,
}, null, 2) + '\n');
fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
fs.copyFileSync(path.join(mobile, 'assets/context-app-logo.png'), path.join(root, 'assets/context-app-logo.png'));
fs.copyFileSync(path.resolve(root, '../../LICENSE'), path.join(root, 'LICENSE'));
console.log(`Snapshotted ${manifest.length} phone protocol source files; no private state included.`);
