export const lightColors = {
  ink: '#171817',
  graphite: '#2B2C2A',
  muted: '#6E706C',
  hairline: '#DDD9D1',
  panel: '#F5F2EC',
  paper: '#FBFAF7',
  white: '#FFFFFF',
  silver: '#C9C5BC',
  success: '#5E7464',
  warning: '#9A7653',
  danger: '#8C554F',
  surface: '#FFFFFF',
  accent: '#171817',
  onAccent: '#FFFFFF',
  onAccentMuted: '#D2D0CA',
  switchTrackOff: '#D5D2CB',
  switchTrackOn: '#7A8079',
  switchThumb: '#FFFFFF',
  scrim: 'rgba(0,0,0,0.45)',
  swatchBorder: '#00000033',
  calendarCell: '#F1EEE8',
  currentTime: '#77707F',
  selectedDay: '#D4CCE6',
  onSelectedDay: '#211B2E',
};

export type AppColors = typeof lightColors;

export const darkColors: AppColors = {
  ink: '#F0EDF2',
  graphite: '#E1DEE5',
  muted: '#B0ADB7',
  hairline: '#3B3941',
  panel: '#29292E',
  paper: '#202024',
  white: '#FFFFFF',
  silver: '#65626D',
  success: '#96B59F',
  warning: '#C5A47C',
  danger: '#D7A2A2',
  surface: '#141418',
  accent: '#DFDCE4',
  onAccent: '#202024',
  onAccentMuted: '#46434C',
  switchTrackOff: '#54515B',
  switchTrackOn: '#A8A1B3',
  switchThumb: '#F3EFF7',
  scrim: 'rgba(0,0,0,0.65)',
  swatchBorder: '#FFFFFF55',
  calendarCell: '#141418',
  currentTime: '#E5E0ED',
  selectedDay: '#C4B8E7',
  onSelectedDay: '#211B2E',
};

// Non-visual services and older integrations use the stable light palette. Screens use useAppTheme.
export const colors = lightColors;

export type AppearanceMode = 'system' | 'light' | 'dark';

export function normalizeAppearanceMode(value: unknown): AppearanceMode {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveAppearanceMode(mode: AppearanceMode, system: string | null | undefined): 'light' | 'dark' {
  return mode === 'system' ? system === 'dark' ? 'dark' : 'light' : mode;
}

export type ActivityCategory = {
  id: string;
  name: string;
  color: string;
  archived?: boolean;
  provider?: 'google' | 'microsoft' | 'device';
  accountId?: string;
  calendarId?: string;
  providerColorId?: string;
  providerLabelId?: string;
  providerCategoryName?: string;
  providerOriginalName?: string;
  providerOriginalColor?: string;
  /** Google returned this exact color; absent on legacy calendar fallback records. */
  googleColorVerified?: boolean;
  updatedAt?: string;
};

// New installations use documented Google Calendar hexes. Stored category records
// are hydrated unchanged, so this does not recolor an existing ledger's history.
export const DEFAULT_CATEGORIES: ActivityCategory[] = [
  { id: 'sleep', name: 'Sleep', color: '#705770' },
  { id: 'physiological', name: 'Physiological needs', color: '#29527A' },
  { id: 'work', name: 'Work', color: '#AB8B00' },
  { id: 'study', name: 'Study', color: '#1B887A' },
  { id: 'family', name: 'Family & people', color: '#BE6D00' },
  { id: 'care', name: 'Hygiene & care', color: '#B1365F' },
  { id: 'prayer', name: 'Prayer', color: '#0D7813' },
  { id: 'exercise', name: 'Exercise', color: '#5229A3' },
  { id: 'unaccounted', name: 'Unaccounted', color: '#5A6986' },
];

// Kept as a stable array reference so existing screens and categoryById see hydrated metadata.
export const CATEGORIES: ActivityCategory[] = DEFAULT_CATEGORIES.map((category) => ({ ...category }));

export function setCategoryCache(categories: ActivityCategory[]) {
  CATEGORIES.splice(0, CATEGORIES.length, ...categories);
}

export type CategoryId = string;

export function categoryById(id: string) {
  return CATEGORIES.find((category) => category.id === id) ??
    { id, name: id === 'unaccounted' ? 'Unaccounted' : 'Other recorded category', color: '#5A6986' };
}
