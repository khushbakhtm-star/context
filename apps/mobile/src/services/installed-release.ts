import { compareReleaseNumbers, type InstalledRelease, type ReleaseChannel } from './updates';

type EmbeddedConfig = {
  version?: string;
  android?: { package?: string; versionCode?: number };
  ios?: { bundleIdentifier?: string; buildNumber?: string };
};

/**
 * These builds embed their release config, use local native version numbers, and do not enable
 * remote JavaScript updates. Release verification checks the resulting APK identity against it.
 * This avoids an attribution SDK that expo-application brings into the Android dependency graph.
 */
export function installedReleaseFromEmbeddedConfig({
  platform, channel, config, executionEnvironment, development, iosNativeBuildNumber,
}: {
  platform: string;
  channel: ReleaseChannel;
  config: EmbeddedConfig | null;
  executionEnvironment: string;
  development: boolean;
  iosNativeBuildNumber?: string | null;
}): InstalledRelease | null {
  if (development || !['bare', 'standalone'].includes(executionEnvironment) || !config ||
      (platform !== 'android' && platform !== 'ios')) return null;
  const applicationId = platform === 'android' ? config.android?.package : config.ios?.bundleIdentifier;
  const version = config.version;
  if (applicationId !== 'com.context.minuteledger' || !version ||
      compareReleaseNumbers(version, version, true) !== 0) return null;
  let buildNumber: string;
  if (platform === 'android') {
    const code = config.android?.versionCode;
    if (!Number.isSafeInteger(code) || !code || code < 1 || code > 2100000000) return null;
    buildNumber = String(code);
  } else {
    buildNumber = iosNativeBuildNumber ?? config.ios?.buildNumber ?? '';
    if ((compareReleaseNumbers(buildNumber, '0') ?? -1) <= 0) return null;
  }
  return { platform, channel, applicationId, version, buildNumber };
}
