const fs = require('node:fs');
const path = require('node:path');
const { withSettingsGradle, withDangerousMod } = require('expo/config-plugins');

const MARKER = '// Context: native Wear OS companion';

function includeWear(source) {
  if (source.includes(MARKER)) return source;
  return `${source.trimEnd()}\n\n${MARKER}\ninclude ':wear'\nproject(':wear').projectDir = new File(rootProject.projectDir, 'wear')\n`;
}

function generateWear(projectRoot, androidRoot, config) {
  const target = path.join(androidRoot, 'wear');
  const source = path.join(projectRoot, 'wear-support', 'watch');
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  const buildFile = path.join(target, 'build.gradle');
  const versionCode = config.android?.versionCode;
  if (!Number.isInteger(versionCode) || versionCode < 1 || typeof config.version !== 'string') {
    throw new Error('The watch companion requires the phone release version and versionCode.');
  }
  const build = fs.readFileSync(buildFile, 'utf8')
    .replaceAll('CONTEXT_VERSION_CODE', String(100_000 + versionCode))
    .replaceAll('CONTEXT_VERSION_NAME', JSON.stringify(config.version));
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
    generateWear(mod.modRequest.projectRoot, mod.modRequest.platformProjectRoot, mod);
    return mod;
  }]);
}

module.exports = withContextWear;
module.exports.includeWear = includeWear;
module.exports.generateWear = generateWear;
