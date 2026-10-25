const { withGradleProperties, withDangerousMod } = require('expo/config-plugins');
const { prepareInstalledSources } = require('../scripts/fdroid-source-inputs.cjs');

module.exports = function withFdroidSource(config) {
  config = withGradleProperties(config, (mod) => {
    const values = { 'expo.core.buildFromSource': 'true', 'expo.sqlite.withSQLiteVecExtension': 'false',
      'expo.sqlite.useSQLCipher': 'false' };
    mod.modResults = mod.modResults.filter((item) => item.type !== 'property' || !(item.key in values));
    for (const [key, value] of Object.entries(values)) mod.modResults.push({ type: 'property', key, value });
    return mod;
  });
  return withDangerousMod(config, ['android', async (mod) => {
    // Expo has extracted its native template before applying config mods. Leave the template
    // archive present for EAS; the official post-prebuild sanitation step removes it later.
    prepareInstalledSources(mod.modRequest.projectRoot, { removeTemplate: false });
    return mod;
  }]);
};
