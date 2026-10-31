import type { ActivityCategory } from '../theme';

/** Offline Google Calendar colors explicitly enumerated by Google's CalendarApp.Color
 * reference. These are calendar colors, not event colorId values and not a claim to
 * enumerate the current 24-color event picker. Connected Google palettes/labels below
 * extend this fallback using their exact returned background hex values.
 * https://developers.google.com/apps-script/reference/calendar/color
 * https://developers.google.com/workspace/calendar/api/v3/reference/colors
 * https://developers.google.com/workspace/calendar/api/guides/labels
 */
export const GOOGLE_ACTIVITY_COLORS = [
  '#2952A3', '#8D6F47', '#4E5D6C', '#865A5A', '#5A6986', '#0D7813', '#5229A3',
  '#528800', '#88880E', '#6E6E41', '#BE6D00', '#B1365F', '#705770', '#7A367A',
  '#A32929', '#B1440E', '#29527A', '#4A716C', '#28754E', '#1B887A', '#AB8B00',
] as const;

export const DEFAULT_GOOGLE_ACTIVITY_COLOR = '#5A6986';
const HEX = /^#[0-9a-f]{6}$/i;

export function googleActivityColorValues(categories: readonly ActivityCategory[]): string[] {
  const colors = new Set<string>(GOOGLE_ACTIVITY_COLORS);
  for (const category of categories) {
    if (category.customColor === true) continue;
    const nativeEventColor = category.provider === 'device' && category.calendarId && category.providerColorId && category.googleColorVerified === true;
    if (!nativeEventColor && (category.provider !== 'google' || !category.accountId)) continue;
    // Released event/label imports already used exact API backgrounds. Legacy
    // calendar-only imports could contain the adapter's invented display fallback.
    if (category.googleColorVerified !== true && !category.providerColorId && !category.providerLabelId) continue;
    // The original provider value remains the provenance when an older client has
    // changed its local display color. It must not authorize that arbitrary edit.
    const original = category.providerOriginalColor ?? category.color;
    if (typeof original === 'string' && HEX.test(original)) colors.add(original.toUpperCase());
  }
  return [...colors];
}

export function isAllowedGoogleActivityColor(color: unknown, categories: readonly ActivityCategory[]): color is string {
  return typeof color === 'string' && HEX.test(color) &&
    googleActivityColorValues(categories).includes(color.toUpperCase());
}

/** This marker is written only by an explicit user color command. Source imports
 * do not set it, and an override never expands the verified Google palette. */
export function isExplicitCustomActivityCategory(category: ActivityCategory): boolean {
  return category.customColor === true && typeof category.id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(category.id) && HEX.test(category.color);
}

export function isSelectableActivityCategory(category: ActivityCategory, categories: readonly ActivityCategory[]): boolean {
  return !category.archived && !category.paletteOnly && HEX.test(category.color) && (isExplicitCustomActivityCategory(category) ||
    (!(category.provider === 'google' && category.providerOriginalColor &&
      category.color.toUpperCase() !== category.providerOriginalColor.toUpperCase()) && isAllowedGoogleActivityColor(category.color, categories)));
}

/** Callers supply actual verified event/target-label or native bridge colors.
 * A stable key breaks equal RGB distances independently of input ordering. */
export function nearestVerifiedGoogleColor<T extends { key: string; color: string }>(hex: string, candidates: readonly T[]): T | undefined {
  if (!HEX.test(hex)) return undefined;
  const rgb = (value: string) => [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  const wanted = rgb(hex);
  let best: T | undefined; let distance = Infinity;
  for (const candidate of candidates) {
    if (typeof candidate.key !== 'string' || !candidate.key || !HEX.test(candidate.color)) continue;
    const value = rgb(candidate.color);
    const next = value.reduce((sum, channel, index) => sum + (channel - wanted[index]!) ** 2, 0);
    if (next < distance || next === distance && (!best || candidate.key < best.key ||
        candidate.key === best.key && candidate.color.toUpperCase() < best.color.toUpperCase())) { best = candidate; distance = next; }
  }
  return best;
}
