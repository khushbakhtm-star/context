import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const fdroid = process.env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION === 'fdroid';
  const iosClient = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const scheme = iosClient?.endsWith('.apps.googleusercontent.com')
    ? `com.googleusercontent.apps.${iosClient.slice(0, -'.apps.googleusercontent.com'.length)}`
    : undefined;
  const plugins = (config.plugins ?? []).filter((plugin) => {
    const name = typeof plugin === 'string' ? plugin : plugin[0];
    return name !== './plugins/with-fdroid-source.cjs' && name !== '@react-native-google-signin/google-signin' &&
      (!fdroid || name !== 'expo-dev-client');
  });
  // A source checkout can bundle before credentials are supplied. Real iOS sign-in requires the
  // registered reversed client scheme, injected into the native project at build time.
  if (!fdroid) {
    if (scheme) plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme: scheme }]);
    else plugins.push('@react-native-google-signin/google-signin');
  } else {
    plugins.push('./plugins/with-fdroid-source.cjs');
  }
  return { ...config, name: config.name ?? 'Context', slug: config.slug ?? 'context-minute-ledger',
    plugins, extra: { ...config.extra, distribution: fdroid ? 'fdroid' : 'store' } };
};
