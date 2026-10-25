const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const defaultResolver = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (process.env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION === 'fdroid' &&
      moduleName === '@react-native-google-signin/google-signin') {
    return { type: 'sourceFile', filePath: path.resolve(__dirname, 'src/sync/google-signin-unavailable.js') };
  }
  return defaultResolver
    ? defaultResolver(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
