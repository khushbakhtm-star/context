const fdroid = process.env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION === 'fdroid';

module.exports = fdroid ? {
  dependencies: {
    '@react-native-google-signin/google-signin': {
      platforms: { android: null, ios: null },
    },
  },
} : {};
