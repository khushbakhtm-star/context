export type ReleaseChannel = 'google-play' | 'apple-app-store' | 'fdroid' | 'standalone' | 'standalone-wear';
export type ReleasePlatform = 'android' | 'ios';

export type InstalledRelease = {
  platform: ReleasePlatform;
  channel: ReleaseChannel;
  applicationId: string;
  version: string;
  buildNumber: string;
};

export type ReleasedUpdate = InstalledRelease & {
  released: true;
  publishedAt: string;
  url: string;
};

export type ReleaseManifest = { schemaVersion: 1; releases: ReleasedUpdate[] };
export type ReleaseLinkTrust = { appleAppStoreId?: string; standaloneReleaseUrl?: string };

const CHANNELS: ReleaseChannel[] = ['google-play', 'apple-app-store', 'fdroid', 'standalone', 'standalone-wear'];
const MAX_MANIFEST_BYTES = 128 * 1024;
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function numericParts(value: string, version: boolean): number[] | null {
  if (!(version ? /^\d+\.\d+\.\d+$/ : /^\d+(?:\.\d+){0,2}$/).test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every((part) => Number.isSafeInteger(part) && part >= 0) ? parts : null;
}

export function compareReleaseNumbers(left: string, right: string, version = false): number | null {
  const a = numericParts(left, version);
  const b = numericParts(right, version);
  if (!a || !b) return null;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function httpsReleaseUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
        !url.hostname.includes('.') || url.hostname.endsWith('.local') || url.hostname.endsWith('.') ||
        /^[\d.]+$/.test(url.hostname)) return null;
    return url;
  } catch { return null; }
}

export function parseReleaseManifest(value: unknown, now = Date.now()): ReleaseManifest | null {
  if (!value || typeof value !== 'object') return null;
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== 1 || !Array.isArray(root.releases) || root.releases.length > 100) return null;
  const releases: ReleasedUpdate[] = [];
  for (const item of root.releases) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const buildNumber = typeof entry.buildNumber === 'number' ? String(entry.buildNumber) : entry.buildNumber;
    if ((entry.platform !== 'android' && entry.platform !== 'ios') ||
        !CHANNELS.includes(entry.channel as ReleaseChannel) || entry.released !== true ||
        typeof entry.applicationId !== 'string' || !/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(entry.applicationId) ||
        typeof entry.version !== 'string' || !numericParts(entry.version, true) ||
        typeof buildNumber !== 'string' || !numericParts(buildNumber, false) ||
        (compareReleaseNumbers(buildNumber, '0') ?? 0) <= 0 ||
        typeof entry.publishedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(entry.publishedAt) ||
        !Number.isFinite(Date.parse(entry.publishedAt)) || Date.parse(entry.publishedAt) > now ||
        new Date(entry.publishedAt).toISOString() !== (entry.publishedAt.length === 20 ?
          `${entry.publishedAt.slice(0, -1)}.000Z` : entry.publishedAt) ||
        !httpsReleaseUrl(entry.url)) continue;
    if (entry.platform === 'android' && (!/^\d+$/.test(buildNumber) || Number(buildNumber) > 2100000000)) continue;
    if (entry.channel === 'standalone-wear' && entry.platform !== 'android') continue;
    if ((entry.channel === 'apple-app-store') !== (entry.platform === 'ios') && entry.channel !== 'standalone') continue;
    releases.push({ platform: entry.platform, channel: entry.channel as ReleaseChannel,
      applicationId: entry.applicationId, version: entry.version, buildNumber,
      released: true, publishedAt: entry.publishedAt, url: entry.url as string });
  }
  return { schemaVersion: 1, releases };
}

export function trustedReleaseLink(release: ReleasedUpdate, trust: ReleaseLinkTrust): boolean {
  if (release.channel === 'standalone-wear' && release.platform !== 'android') return false;
  const url = httpsReleaseUrl(release.url);
  if (!url) return false;
  if (release.channel === 'google-play') {
    return url.hostname === 'play.google.com' && url.pathname === '/store/apps/details' &&
      [...url.searchParams.keys()].length === 1 && url.searchParams.get('id') === release.applicationId;
  }
  if (release.channel === 'fdroid') {
    return url.hostname === 'f-droid.org' && !url.search &&
      url.pathname.replace(/\/$/, '') === `/packages/${release.applicationId}`;
  }
  if (release.channel === 'apple-app-store') {
    if (!trust.appleAppStoreId || !/^\d+$/.test(trust.appleAppStoreId)) return false;
    const match = url.pathname.match(/^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id(\d+)\/?$/);
    return url.hostname === 'apps.apple.com' && !url.search && match?.[1] === trust.appleAppStoreId;
  }
  const expected = httpsReleaseUrl(trust.standaloneReleaseUrl);
  return expected !== null && url.href === expected.href;
}

export function selectAvailableRelease(
  manifest: ReleaseManifest,
  installed: InstalledRelease,
  trust: ReleaseLinkTrust = {},
): ReleasedUpdate | null {
  if (installed.channel === 'standalone-wear' && installed.platform !== 'android') return null;
  if (!numericParts(installed.version, true) || !numericParts(installed.buildNumber, false)) return null;
  const available = manifest.releases.filter((release) =>
    release.platform === installed.platform && release.channel === installed.channel &&
    release.applicationId === installed.applicationId &&
    (compareReleaseNumbers(release.version, installed.version, true) ?? -1) >= 0 &&
    ((installed.platform === 'ios' && (compareReleaseNumbers(release.version, installed.version, true) ?? 0) > 0) ||
      (compareReleaseNumbers(release.buildNumber, installed.buildNumber) ?? -1) > 0) &&
    trustedReleaseLink(release, trust));
  available.sort((a, b) => (installed.platform === 'ios' ? compareReleaseNumbers(b.version, a.version, true) ?? 0 : 0) ||
    (compareReleaseNumbers(b.buildNumber, a.buildNumber) ?? 0));
  return available[0] ?? null;
}

export function releaseNoticeKey(release: InstalledRelease): string {
  return `${release.platform}:${release.channel}:${release.applicationId}:${release.version}:${release.buildNumber}`;
}

export function shouldCheckForUpdate(lastCheck: number, now = Date.now()): boolean {
  return !Number.isFinite(lastCheck) || lastCheck <= 0 || now < lastCheck || now - lastCheck >= UPDATE_CHECK_INTERVAL_MS;
}

function exceedsByteLimit(text: string): boolean {
  let size = 0;
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    size += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (size > MAX_MANIFEST_BYTES) return true;
  }
  return false;
}

/** Only the configured public manifest URL is requested. No ledger, account, or device identifiers are sent. */
export async function fetchReleaseManifest(
  manifestUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<ReleaseManifest | null> {
  const url = httpsReleaseUrl(manifestUrl);
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(url.href, { method: 'GET', headers: { Accept: 'application/json' },
      credentials: 'omit', redirect: 'error', signal: controller.signal });
    if (!response.ok || (response.url && response.url !== url.href)) return null;
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_MANIFEST_BYTES)) return null;
    const text = await response.text();
    if (text.length > MAX_MANIFEST_BYTES || exceedsByteLimit(text)) return null;
    return parseReleaseManifest(JSON.parse(text));
  } catch { return null; }
  finally { clearTimeout(timer); }
}
