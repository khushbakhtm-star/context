const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(ROOT, 'tmp/release');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PROFILES = new Map([['google-play', 'ANDROID'], ['apple-app-store', 'IOS'], ['fdroid-preview', 'ANDROID']]);
const VERSION_TAG = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

function git(...args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Git verification failed: ${args[0]}`);
  return result.stdout.trim();
}

function validatePlan(plan, app, pkg, tag) {
  if (!VERSION_TAG.test(tag ?? '')) {
    throw new Error('Run this workflow on a version tag such as v0.1.0; arbitrary refs are refused.');
  }
  if (plan.schemaVersion !== 1 || `v${plan.version}` !== tag || app.version !== plan.version || pkg.version !== plan.version ||
    app.android?.versionCode !== plan.sourceAndroidVersionCode ||
    String(app.ios?.buildNumber) !== plan.sourceIosBuildNumber ||
    app.android?.package !== 'com.context.minuteledger' || app.ios?.bundleIdentifier !== 'com.context.minuteledger') {
    throw new Error('Release tag, plan, package version, native source build numbers, and application IDs must agree.');
  }
  if (!Number.isSafeInteger(plan.sourceAndroidVersionCode) || plan.sourceAndroidVersionCode < 1 ||
    !/^[1-9]\d*$/.test(plan.sourceIosBuildNumber) || !Number.isSafeInteger(Number(plan.sourceIosBuildNumber))) {
    throw new Error('Native source build numbers must be positive integers.');
  }
  for (const platform of ['android', 'ios', 'fdroid']) {
    if (typeof plan.nativeVerification?.[platform] !== 'boolean') throw new Error(`Native verification state missing for ${platform}.`);
  }
  if (typeof plan.notes !== 'string' || !plan.notes.trim() || plan.notes.length > 5000) throw new Error('Provide concise release notes.');
  return plan;
}

function validateEasReleaseConfig(eas) {
  if (eas.cli?.appVersionSource !== 'local' || eas.build?.production?.autoIncrement !== false ||
    eas.build.production.distribution !== 'store' || eas.build.production.android?.buildType !== 'app-bundle' ||
    eas.build.production.ios?.simulator !== false ||
    eas.build['google-play']?.extends !== 'production' || eas.build['apple-app-store']?.extends !== 'production' ||
    eas.build['fdroid-preview']?.distribution !== 'internal' ||
    eas.build['fdroid-preview']?.env?.EXPO_PUBLIC_CONTEXT_DISTRIBUTION !== 'fdroid' ||
    eas.submit?.['google-play']?.android?.track !== 'internal' ||
    eas.submit?.['google-play']?.android?.releaseStatus !== 'draft') {
    throw new Error('Release profiles must preserve local immutable versions, FOSS preview separation, and draft/internal store staging.');
  }
}

function compareVersion(left, right) {
  const a = left.replace(/^v/, '').split('.').map(BigInt);
  const b = right.replace(/^v/, '').split('.').map(BigInt);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function verifyIncreasingBuilds(plan, previous) {
  if (!Number.isSafeInteger(previous.android?.versionCode) || previous.android.versionCode < 1 ||
    plan.sourceAndroidVersionCode <= previous.android.versionCode ||
    !/^\d+$/.test(String(previous.ios?.buildNumber)) ||
    BigInt(plan.sourceIosBuildNumber) <= BigInt(previous.ios.buildNumber)) {
    throw new Error('Bump both native build numbers above the preceding source release before tagging.');
  }
}

function verifyTag(env, localOnly = false) {
  const tag = env.RELEASE_TAG || env.GITHUB_REF_NAME;
  const plan = validatePlan(JSON.parse(fs.readFileSync(path.join(ROOT, '.github/release-plan.json'))),
    JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/mobile/app.json'))).expo,
    JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/mobile/package.json'))), tag);
  validateEasReleaseConfig(JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/mobile/eas.json'))));
  if (localOnly) return { plan };
  if (env.GITHUB_REF_TYPE !== 'tag' || env.GITHUB_SERVER_URL !== 'https://github.com' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY ?? '')) {
    throw new Error('Release automation requires a real GitHub tag event in its source repository.');
  }
  const commit = git('rev-parse', 'HEAD');
  if (!/^[a-f0-9]{40}$/.test(commit) || git('rev-parse', `${tag}^{commit}`) !== commit) {
    throw new Error('Checked-out commit does not match the release tag.');
  }
  const branch = env.DEFAULT_BRANCH;
  if (!branch || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes('..')) {
    throw new Error('The repository default branch is missing or invalid.');
  }
  git('merge-base', '--is-ancestor', commit, `refs/remotes/origin/${branch}`);
  const remote = git('ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`);
  const refs = new Map(remote.split('\n').filter(Boolean).map((line) => line.split(/\s+/).reverse()));
  if ((refs.get(`refs/tags/${tag}^{}`) || refs.get(`refs/tags/${tag}`)) !== commit) {
    throw new Error('Remote tag moved or does not resolve to the checked-out commit.');
  }
  const previousTags = git('tag', '--merged', 'HEAD', '--list', 'v*').split('\n')
    .filter((value) => value !== tag && VERSION_TAG.test(value)).sort(compareVersion);
  const previousTag = previousTags.at(-1);
  if (previousTag) {
    if (compareVersion(previousTag, tag) >= 0) throw new Error('A newer release tag already exists in this source history.');
    const previous = JSON.parse(git('show', `${previousTag}:apps/mobile/app.json`)).expo;
    verifyIncreasingBuilds(plan, previous);
  }
  return { plan, tag, commit, repo: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}` };
}

function summarizeBuild(payload, profile, expectedCommit, plan) {
  const builds = Array.isArray(payload) ? payload : [payload];
  if (builds.length !== 1 || !PROFILES.has(profile)) throw new Error('Expected exactly one build for a known release profile.');
  const build = builds[0];
  if (!build || !UUID.test(build.id ?? '') || build.platform !== PROFILES.get(profile) || build.status !== 'FINISHED' ||
    (build.gitCommitHash && build.gitCommitHash !== expectedCommit)) {
    throw new Error('EAS did not return the expected finished release build.');
  }
  if (plan && (build.appVersion !== plan.version || String(build.appBuildVersion) !==
    (build.platform === 'IOS' ? plan.sourceIosBuildNumber : String(plan.sourceAndroidVersionCode)))) {
    throw new Error('EAS build version or native build number differs from the immutable release plan.');
  }
  // Deliberately exclude artifact URLs, logs, account details, environment variables, and credentials.
  return { schemaVersion: 1, profile, platform: build.platform.toLowerCase(), buildId: build.id,
    status: build.status, sourceCommit: expectedCommit,
    version: typeof build.appVersion === 'string' ? build.appVersion : null,
    buildNumber: ['string', 'number'].includes(typeof build.appBuildVersion) ? String(build.appBuildVersion) : null };
}

function sourceNotes({ plan, commit, repo }) {
  return `Context ${plan.version} source prerelease\n\n${plan.notes}\n\nSource commit: ${commit}\n\n` +
    `This release contains source and F-Droid packaging candidates. A completed Expo build, store upload, or packaging request is not public store availability. ` +
    `Google Play and Apple reviews and F-Droid's independent review happen separately. No user update is announced by this source release.\n\n` +
    `Build/release process: ${repo}/blob/${commit}/apps/mobile/docs/RELEASE_PROCESS.md\n`;
}

function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'check' || mode === 'verify') {
    const release = verifyTag(process.env, mode === 'check');
    if (mode === 'check') { process.stdout.write('Release plan agrees with the source versions.\n'); return; }
    fs.mkdirSync(OUTPUT, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT, 'release-plan.json'), `${JSON.stringify({ ...release.plan, sourceCommit: release.commit }, null, 2)}\n`);
    fs.writeFileSync(path.join(OUTPUT, 'source-release-notes.md'), sourceNotes(release));
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${release.plan.version}\ncommit=${release.commit}\n` +
        `native_android=${release.plan.nativeVerification.android}\nnative_ios=${release.plan.nativeVerification.ios}\n` +
        `native_fdroid=${release.plan.nativeVerification.fdroid}\n`);
    }
    process.stdout.write(`Verified ${release.tag} at ${release.commit}.\n`);
    return;
  }
  if (mode === 'build-summary') {
    const [input, profile, output] = args;
    const expected = process.env.RELEASE_COMMIT;
    if (!/^[a-f0-9]{40}$/.test(expected ?? '')) throw new Error('Missing immutable release commit.');
    const summary = summarizeBuild(JSON.parse(fs.readFileSync(input)), profile, expected,
      JSON.parse(fs.readFileSync(path.join(ROOT, '.github/release-plan.json'))));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`Recorded finished ${profile} build ${summary.buildId}.\n`);
    return;
  }
  if (mode === 'build-id') {
    const summary = JSON.parse(fs.readFileSync(args[0]));
    if (!UUID.test(summary.buildId ?? '') || summary.status !== 'FINISHED') throw new Error('Invalid finished build summary.');
    process.stdout.write(summary.buildId);
    return;
  }
  throw new Error('Use check, verify, build-summary, or build-id.');
}

module.exports = { validatePlan, validateEasReleaseConfig, compareVersion, verifyIncreasingBuilds, summarizeBuild, sourceNotes };
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
