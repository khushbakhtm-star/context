const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const APP_ID = 'com.context.minuteledger';
const LISTING = 'fastlane/metadata/android/en-US';
const TEMPLATE = 'apps/mobile/fdroid/com.context.minuteledger.yml.template';

function validatePublicUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an actual public HTTPS URL.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    !url.hostname.includes('.') || /(^|\.)(localhost|example\.(com|org|net))$/i.test(url.hostname) ||
    /OWNER_|PUBLIC_|REPLACE|PLACEHOLDER/i.test(value)) {
    throw new Error(`${label} must be an actual public HTTPS URL without credentials or placeholders.`);
  }
  return url.href.replace(/\/$/, '');
}

function validateCommit(value) {
  if (!/^[a-f0-9]{40}$/i.test(value ?? '')) {
    throw new Error('Use the full 40-character immutable Git release commit hash.');
  }
  return value.toLowerCase();
}

function validateListing(readFile) {
  const config = JSON.parse(readFile('apps/mobile/app.json').toString('utf8')).expo;
  const version = config.version;
  const versionCode = config.android?.versionCode;
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !Number.isSafeInteger(versionCode) ||
    versionCode < 1 || config.android?.package !== APP_ID) {
    throw new Error('Use a numeric release version, positive Android version code, and the Context application ID.');
  }
  const short = readFile(`${LISTING}/short_description.txt`).toString('utf8').trimEnd();
  const full = readFile(`${LISTING}/full_description.txt`).toString('utf8').trimEnd();
  const title = readFile(`${LISTING}/title.txt`).toString('utf8').trimEnd();
  const changelog = readFile(`${LISTING}/changelogs/${versionCode}.txt`).toString('utf8').trimEnd();
  if (!short || [...short].length >= 80 || /\.$/.test(short) || short.includes('\n')) {
    throw new Error('Short description must be one line, less than 80 characters, without a trailing dot.');
  }
  if (!full || [...full].length > 4000) throw new Error('Full description must be 1–4,000 characters.');
  if (!title || [...title].length > 50) throw new Error('Title must be 1–50 characters.');
  if (!changelog || [...changelog].length > 500) throw new Error(`Version-code-${versionCode} changelog must be 1–500 characters.`);
  const icon = readFile(`${LISTING}/images/icon.png`);
  const approved = readFile('apps/mobile/assets/context-app-logo.png');
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  if (!icon.equals(approved)) throw new Error('Listing icon must match the approved app asset byte for byte.');
  if (!icon.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('The listing icon is not a PNG.');
  }
  if (!readFile('LICENSE').toString('utf8').includes('MIT License')) throw new Error('MIT source license is missing.');
  for (const source of ['apps/mobile/App.tsx', 'apps/mobile/index.ts', 'apps/mobile/package.json',
    'apps/mobile/pnpm-lock.yaml', 'apps/mobile/src/data/database.ts', 'apps/mobile/src/sync/webdav.ts',
    'apps/mobile/scripts/prepare-fdroid.cjs']) {
    if (readFile(source).length === 0) throw new Error(`Required release source is empty: ${source}`);
  }
  const template = readFile(TEMPLATE).toString('utf8');
  if (!template.includes('disable: Public source URL') || !template.includes('NonFreeNet:')) {
    throw new Error('Keep the unverified build disabled and its optional proprietary services disclosed.');
  }
  return { short, title, version, versionCode, iconSha256: digest(icon), shortLength: [...short].length,
    fullLength: [...full].length, changelogLength: [...changelog].length };
}

function readCommitFile(commit, relativePath) {
  const result = spawnSync('git', ['show', `${commit}:${relativePath}`], {
    cwd: REPOSITORY_ROOT, encoding: null, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Release commit lacks ${relativePath}. Commit the complete release material first.`);
  return result.stdout;
}

function renderCandidate(template, values) {
  return template
    .replaceAll('OWNER_PUBLIC_SOURCE_REPOSITORY_URL', JSON.stringify(values.repo))
    .replaceAll('OWNER_PUBLIC_ISSUE_TRACKER_URL', JSON.stringify(values.issues))
    .replaceAll('OWNER_PUBLIC_RELEASES_URL', JSON.stringify(values.releases))
    .replaceAll('OWNER_IMMUTABLE_RELEASE_COMMIT', values.commit)
    .replace(/^(\s+- versionName: ).+$/m, (_match, prefix) => `${prefix}${values.version}`)
    .replace(/^(\s+versionCode: )\d+$/m, (_match, prefix) => `${prefix}${values.versionCode}`)
    .replace(/^CurrentVersion: .+$/m, `CurrentVersion: ${values.version}`)
    .replace(/^CurrentVersionCode: \d+$/m, `CurrentVersionCode: ${values.versionCode}`)
    .replace('disable: Public source URL, release commit, pinned build-server toolchain, dependency scan, and native verification are pending',
      'disable: Pinned build-server toolchain, dependency scan, and native verification are pending');
}

function renderRequest(values, listing) {
  return `# Packaging review: Context (${APP_ID})

## Source and release

- Source: ${values.repo}
- Issue tracker: ${values.issues}
- Releases: ${values.releases}
- Requested version: ${listing.version} (version code ${listing.versionCode})
- Release commit: ${values.commit}
- Expected tag: v${listing.version} (remote tag still needs verification)
- License: MIT
- Summary: ${listing.short}

The app owner has requested public source publication and F-Droid review.

## Application and edition

Context implements a local minute-by-minute activity ledger, custom categories,
day/week/month/year category reports, Android device-calendar access, and optional
encrypted ledger synchronization through a dedicated HTTPS WebDAV folder.

The F-Droid source preparation removes Google's native sign-in dependency and the
Expo development client before dependency installation. It has no direct Google
account sign-in. Optional Microsoft calendar and OneDrive features need the
publisher's Microsoft app registration; that configuration is not included in this
source release. NonFreeNet is disclosed for those optional proprietary services.
Local ledger, Android calendars, and WebDAV do not need a Microsoft account.

## Packaging status and help requested

- [x] MIT license and upstream listing files are present in the selected local commit.
- [x] The approved logo is supplied as the listing icon; no mock screenshots are presented as captures.
- [ ] Verify the source URL is publicly cloneable and v${listing.version} resolves to the release commit above.
- [ ] Establish and pin the accepted Linux/Android/Node/pnpm build-server environment.
- [ ] Run fdroidserver metadata lint, dependency scanner, and an unsigned native build.
- [ ] Install and validate the native source edition on an Android phone.
- [ ] Capture genuine screenshots after native verification.

The accompanying metadata is an explicitly disabled build candidate. The source
has not yet been demonstrated to build on F-Droid's server. Please advise on the
Expo/React Native packaging and any actual scanner findings before enabling it.
No blanket scanner exclusions are proposed.

## Project history

This generated request does not establish inclusion-policy eligibility. Please
attach the actual public maintenance history and evidence of real users. Do not
claim three months of development, prior F-Droid maintenance, or a policy exception
without evidence. For an already accepted app, link its existing fdroiddata entry
and submit this as an update to that entry instead of opening a duplicate request.

This is a draft request generated locally, not evidence that a GitLab request has
been posted or that F-Droid has accepted the app.
`;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--check') {
    const listing = validateListing((relativePath) => fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath)));
    process.stdout.write(`${JSON.stringify({ listing: 'valid', ...listing }, null, 2)}\n`);
    process.stdout.write('Local content checks only; fdroidserver lint/scanner and native build have not run.\n');
    return;
  }
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--repo', '--issues', '--releases', '--commit'].includes(key) ||
      !args[index + 1] || options[key]) {
      throw new Error('Use --check, or provide --repo URL --issues URL --releases URL --commit FULL_HASH.');
    }
    options[key] = args[index + 1];
  }
  const values = {
    repo: validatePublicUrl(options['--repo'], 'Repository'),
    issues: validatePublicUrl(options['--issues'], 'Issue tracker'),
    releases: validatePublicUrl(options['--releases'], 'Releases'),
    commit: validateCommit(options['--commit']),
  };
  const listing = validateListing((relativePath) => readCommitFile(values.commit, relativePath));
  const template = readCommitFile(values.commit, TEMPLATE).toString('utf8');
  const candidate = renderCandidate(template, { ...values, ...listing });
  if (candidate.includes('OWNER_')) throw new Error('Unresolved metadata placeholder; update the preparation helper.');
  const output = path.join(REPOSITORY_ROOT, 'tmp', 'fdroid-submission', values.commit);
  const recipePath = path.join(output, 'metadata', `${APP_ID}.yml`);
  const requestPath = path.join(output, 'REQUEST_FOR_PACKAGING.md');
  if (fs.existsSync(recipePath) || fs.existsSync(requestPath)) {
    throw new Error(`Submission material already exists at ${output}; inspect it before generating another copy.`);
  }
  fs.mkdirSync(path.dirname(recipePath), { recursive: true });
  fs.writeFileSync(recipePath, candidate, { flag: 'wx' });
  fs.writeFileSync(requestPath, renderRequest(values, listing), { flag: 'wx' });
  process.stdout.write(`Created disabled metadata candidate: ${recipePath}\nDraft packaging request: ${requestPath}\n`);
  process.stdout.write('No publication or F-Droid submission was performed. Verify anonymous remote access and the release tag.\n');
}

module.exports = { validatePublicUrl, validateCommit, validateListing, renderCandidate, renderRequest };
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
