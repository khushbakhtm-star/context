const fs = require('node:fs');
const path = require('node:path');
const { withSettingsGradle, withDangerousMod } = require('expo/config-plugins');

const MARKER = '// Context: native Wear OS companion';

function includeWear(source) {
  if (source.includes(MARKER)) return source;
  return `${source.trimEnd()}\n\n${MARKER}\ninclude ':wear'\nproject(':wear').projectDir = new File(rootProject.projectDir, 'wear')\n`;
}

function readWatchVersion(projectRoot) {
  const filename = path.join(projectRoot, 'wear-support', 'watch', 'version.json');
  if (!fs.existsSync(filename)) throw new Error('The watch companion requires its independent version metadata.');
  const text = fs.readFileSync(filename, 'utf8');
  if (Buffer.byteLength(text, 'utf8') > 2048) throw new Error('The watch version metadata exceeds supported bounds.');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('The watch version metadata is not valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'version,versionCode' ||
      typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version) || value.version.length > 32 ||
      !Number.isSafeInteger(value.versionCode) || value.versionCode < 100001 || value.versionCode > 2100000000) {
    throw new Error('Use an independent watch version and reserved Android versionCode.');
  }
  return value;
}

function generateWear(projectRoot, androidRoot) {
  const version = readWatchVersion(projectRoot);
  const target = path.join(androidRoot, 'wear');
  const source = path.join(projectRoot, 'wear-support', 'watch');
  const template = fs.readFileSync(path.join(source, 'build.gradle'), 'utf8');
  if (template.split('CONTEXT_VERSION_CODE').length !== 2 || template.split('CONTEXT_VERSION_NAME').length !== 2) {
    throw new Error('The reviewed watch version template changed.');
  }
  const build = template.replace('CONTEXT_VERSION_CODE', String(version.versionCode))
    .replace('CONTEXT_VERSION_NAME', JSON.stringify(version.version));
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  const buildFile = path.join(target, 'build.gradle');
  fs.writeFileSync(buildFile, build);
  const resources = path.join(target, 'src', 'main', 'res', 'drawable-nodpi');
  fs.mkdirSync(resources, { recursive: true });
  fs.copyFileSync(path.join(projectRoot, 'assets', 'context-app-logo.png'), path.join(resources, 'context_logo.png'));
}

function withContextWear(config) {
  if (process.env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION === 'fdroid') return config;
  // The phone module is autolinked independently. Generate/build the small watch module
  // only for its dedicated cloud profile, keeping normal phone Gradle tasks unchanged.
  if (process.env.CONTEXT_WEAR_BUILD !== '1') return config;
  config = withSettingsGradle(config, (mod) => {
    mod.modResults.contents = includeWear(mod.modResults.contents);
    return mod;
  });
  return withDangerousMod(config, ['android', async (mod) => {
    generateWear(mod.modRequest.projectRoot, mod.modRequest.platformProjectRoot);
    return mod;
  }]);
}

module.exports = withContextWear;
module.exports.includeWear = includeWear;
module.exports.generateWear = generateWear;
module.exports.readWatchVersion = readWatchVersion;
