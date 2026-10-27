const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'shared/source-manifest.json'), 'utf8'));
if (manifest.version !== 1 || manifest.files.length !== 10) throw new Error('Invalid shared source manifest.');
for (const entry of manifest.files) {
  if (!/^(?:utils\/[a-z-]+|sync\/[a-z-]+|types)\.ts$/.test(entry.path)) throw new Error('Invalid shared source path.');
  const bytes = fs.readFileSync(path.join(root, 'shared', entry.path));
  if (bytes.length !== entry.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    throw new Error(`Shared source differs from its receipt: ${entry.path}`);
  }
  const original = path.resolve(root, '../mobile/src', entry.path);
  if (fs.existsSync(original) && !bytes.equals(Buffer.from(fs.readFileSync(original, 'utf8').replace(/\r\n/g, '\n')))) {
    throw new Error(`Refresh the reviewed phone source snapshot: ${entry.path}`);
  }
}
console.log('All 10 portable protocol sources match their recorded hashes.');
