export const colors = {
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
};

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
  updatedAt?: string;
};

export const DEFAULT_CATEGORIES: ActivityCategory[] = [
  { id: 'sleep', name: 'Sleep', color: '#8B8199' },
  { id: 'physiological', name: 'Physiological needs', color: '#3E5864' },
  { id: 'work', name: 'Work', color: '#B49B55' },
  { id: 'study', name: 'Study', color: '#8DAAB4' },
  { id: 'family', name: 'Family & people', color: '#B87552' },
  { id: 'care', name: 'Hygiene & care', color: '#B57C8B' },
  { id: 'prayer', name: 'Prayer', color: '#667B69' },
  { id: 'exercise', name: 'Exercise', color: '#6B7382' },
  { id: 'unaccounted', name: 'Unaccounted', color: '#96938C' },
];

// Kept as a stable array reference so existing screens and categoryById see hydrated metadata.
export const CATEGORIES: ActivityCategory[] = DEFAULT_CATEGORIES.map((category) => ({ ...category }));

export function setCategoryCache(categories: ActivityCategory[]) {
  CATEGORIES.splice(0, CATEGORIES.length, ...categories);
}

export type CategoryId = string;

export function categoryById(id: string) {
  return CATEGORIES.find((category) => category.id === id) ??
    { id, name: id === 'unaccounted' ? 'Unaccounted' : 'Other recorded category', color: '#96938C' };
}
