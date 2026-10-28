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
