const GOOGLE_PHONE_PROFILES = new Set([
  'preview', 'wear-phone-preview', 'production', 'google-play', 'apple-app-store',
]);

function googleOAuthBuildRequirement(env) {
  if (env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION === 'fdroid' || env.CONTEXT_WEAR_BUILD === '1') return null;
  const optedIn = env.CONTEXT_REQUIRE_GOOGLE_OAUTH === '1';
  if (!optedIn && !GOOGLE_PHONE_PROFILES.has(env.EAS_BUILD_PROFILE)) return null;
  // EAS's built-in profile/platform variables are worker-only: its initial local
  // project discovery has no profile and remains exportable before cloud env is
  // fetched. If a caller supplies a profile but not a platform, check the shared
  // Web ID; the Apple-only profile can safely infer the additional iOS requirement.
  return env.EAS_BUILD_PLATFORM === 'ios' ||
    (!env.EAS_BUILD_PLATFORM && env.EAS_BUILD_PROFILE === 'apple-app-store') ? 'ios' : 'android';
}

function requireClientId(env, name, type) {
  const value = env[name];
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new Error(`Google OAuth build preflight: ${name} must contain a real ${type} client ID with no surrounding whitespace.`);
  }
  const match = /^\d+-([A-Za-z0-9_-]+)\.apps\.googleusercontent\.com$/.exec(value);
  const placeholder = /(?:^|[-_])(?:example|placeholder|your|some|client|replace|todo|test|dummy)(?:[-_]|$)/i;
  if (!match || placeholder.test(match[1])) {
    throw new Error(`Google OAuth build preflight: ${name} is malformed or a placeholder. Supply the ${type} OAuth client ID from the app's Google Cloud project.`);
  }
  return value;
}

function assertGoogleOAuthBuildConfiguration(env = process.env) {
  const platform = googleOAuthBuildRequirement(env);
  if (platform === null) return { required: false };
  requireClientId(env, 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', 'Web application');
  if (platform === 'ios') requireClientId(env, 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', 'iOS');
  return { required: true, platform };
}

module.exports = { GOOGLE_PHONE_PROFILES, googleOAuthBuildRequirement, assertGoogleOAuthBuildConfiguration };

if (require.main === module) {
  try {
    const result = assertGoogleOAuthBuildConfiguration();
    process.stdout.write(result.required
      ? `Google OAuth build preflight passed for ${result.platform}.\n`
      : 'Google OAuth build preflight is not required for this source export or distribution.\n');
  } catch (error) {
    // Client identifiers are public, but omit supplied values so a mistaken secret
    // pasted into one of these fields is never repeated in a CI/build log.
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
