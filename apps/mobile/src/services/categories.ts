import * as Crypto from 'expo-crypto';

import { getMinuteEntry, getSetting, getSyncBindingsForBlock, getSyncDocuments, putSyncDocument, setSetting } from '../data/database';
import { accountFetch, getAccounts } from '../sync/accounts';
import { createCalendarAdapter } from '../sync/providers';
import { hashValue } from '../sync/codec';
import type { AccountProvider, ConnectedAccount } from '../sync/types';
import { CATEGORIES, DEFAULT_CATEGORIES, setCategoryCache } from '../theme';
import type { ActivityCategory } from '../theme';
import type { DeviceCalendar } from '../types';
import { CELL_FORMAT_PREFIX } from '../utils/cell-format';
import { GOOGLE_ACTIVITY_COLORS, googleActivityColorValues, isAllowedGoogleActivityColor } from '../utils/google-activity-colors';
import type { CalendarPreferences } from '../types';

const SETTING = 'activity.categories.v2';
const COLOR = /^#[0-9a-f]{6}$/i;
let mutations: Promise<unknown> = Promise.resolve();
const paletteRefreshJobs = new Map<string, Promise<void>>();
const paletteRefreshTimes = new Map<string, number>();
const paletteListeners = new Set<() => void>();
export function subscribeWritablePaletteChanges(listener: () => void) {
  paletteListeners.add(listener); return () => { paletteListeners.delete(listener); };
}

function refreshPaletteInBackground(key: string, read: () => Promise<ActivityCategory[]>, isCurrent: () => Promise<boolean>) {
  if (paletteRefreshJobs.has(key) || Date.now() - (paletteRefreshTimes.get(key) ?? 0) < 60_000) return;
  const job = (async () => {
    const values = await read();
    await serialized(async () => {
      if (!await isCurrent()) return;
      const before = hashValue(await getSyncDocuments('category:', CELL_FORMAT_PREFIX));
      await importCategories(values);
      const after = hashValue(await getSyncDocuments('category:', CELL_FORMAT_PREFIX));
      if (before !== after) for (const listener of paletteListeners) { try { listener(); } catch { /* Screen unmounted. */ } }
    });
  })().catch(() => { /* Cached verified choices stay available offline; explicit import reports provider errors. */ })
    .finally(() => { paletteRefreshTimes.set(key, Date.now()); if (paletteRefreshJobs.get(key) === job) paletteRefreshJobs.delete(key); });
  paletteRefreshJobs.set(key, job);
}

async function connectedGoogleWriters() {
  const accounts = typeof getAccounts === 'function' ? await getAccounts() : [];
  const projections = await getSyncDocuments('projection:');
  return Promise.all(accounts.filter((account) => account.provider === 'google' && account.consent.calendarRead && account.consent.calendarWrite)
    .map(async (account) => {
      const preferences = await getSetting<{ writeCalendarId?: string | null; selectedCalendarIds?: string[] }>(`account.calendars.${account.id}`, {});
      const labels = new Set<string>();
      if (preferences.writeCalendarId) labels.add(preferences.writeCalendarId);
      for (const document of projections) if (document.value?.accountId === account.id && document.value.state !== 'deleted' &&
          typeof document.value.calendarId === 'string') labels.add(document.value.calendarId);
      const labelCalendars = [...labels].sort().slice(0, 256);
      return { account, labelCalendars, identity: hashValue([account.id, account.subject, account.provider, account.consent,
        preferences.writeCalendarId ?? null, [...(preferences.selectedCalendarIds ?? [])].sort(), labelCalendars]) };
    }));
}

async function readGoogleWritablePalette(account: ConnectedAccount, labelCalendars: readonly string[]): Promise<ActivityCategory[]> {
  const palette = await providerJson(account, 'https://www.googleapis.com/calendar/v3/colors');
  const values: ActivityCategory[] = [];
  for (const [id, item] of Object.entries(palette.event ?? {}).slice(0, 256)) {
    const color = (item as { background?: unknown }).background;
    if (/^[A-Za-z0-9_-]{1,80}$/.test(id) && typeof color === 'string' && COLOR.test(color)) values.push({
      id: stableId(account.id, 'color', id), name: `Google event color ${id}`, color,
      provider: 'google', accountId: account.id, providerColorId: id, googleColorVerified: true,
    });
  }
  if (account.consent.categoryRead) for (const calendarId of labelCalendars) {
    const metadata = await providerJson(account, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}?eventLabelVersion=1`);
    for (const label of (metadata.labelProperties?.eventLabels ?? []).slice(0, 200)) {
      if (typeof label.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(label.id) || !COLOR.test(label.backgroundColor ?? '')) continue;
      values.push({ id: stableId(account.id, calendarId, label.id), name: label.name || `Google label ${label.id}`,
        color: label.backgroundColor, provider: 'google', accountId: account.id, calendarId,
        providerLabelId: label.id, googleColorVerified: true });
    }
  }
  return values;
}

async function readNativeWritablePalette(calendarIds: readonly string[]): Promise<ActivityCategory[]> {
  try {
    const bridge = await import('../../modules/context-calendar-colors');
    if (typeof bridge.getEventPaletteAsync !== 'function') return [];
    return (await bridge.getEventPaletteAsync(calendarIds)).map((item) => ({
      id: stableId('device-event-color', item.calendarId, item.key), name: item.color, color: item.color,
      provider: 'device' as const, calendarId: item.calendarId, providerColorId: item.key, googleColorVerified: true,
    }));
  } catch { return []; }
}

function validCategory(value: unknown): value is ActivityCategory {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as ActivityCategory;
  return typeof candidate.id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(candidate.id) &&
    typeof candidate.name === 'string' && candidate.name.trim().length > 0 && candidate.name.length <= 200 &&
    typeof candidate.color === 'string' && COLOR.test(candidate.color);
}

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const job = mutations.then(work, work);
  mutations = job.then(() => undefined, () => undefined);
  return job;
}

async function writeCategory(category: ActivityCategory) {
  if (!validCategory(category)) throw new Error('Use a category name and a six-digit hexadecimal color.');
  const value = JSON.parse(JSON.stringify(category)) as Record<string, unknown>;
  await putSyncDocument(`category:${category.id}`, value);
}

/** Historical categories remain intact. Stable palette categories make the documented
 * Google fallback available offline without changing an existing activity or its reports. */
export async function listCategories(includeArchived = true): Promise<ActivityCategory[]> {
  let documents = await getSyncDocuments('category:', CELL_FORMAT_PREFIX);
  if (!documents.length) {
    const previous = await getSetting<ActivityCategory[] | null>(SETTING, null);
    const initial = previous?.filter(validCategory) ?? DEFAULT_CATEGORIES;
    for (const category of initial) await writeCategory(category);
    documents = await getSyncDocuments('category:', CELL_FORMAT_PREFIX);
  }
  const values = documents.flatMap((document) =>
    validCategory(document.value) ? [document.value] : []);
  const ids = new Set(values.map((category) => category.id));
  for (const color of GOOGLE_ACTIVITY_COLORS) {
    const id = `google_palette_${color.slice(1).toLowerCase()}`;
    if (ids.has(id)) continue;
    const category = { id, name: color, color };
    await writeCategory(category);
    values.push(category);
  }
  values.sort((left, right) => left.name.localeCompare(right.name));
  setCategoryCache(values);
  await setSetting(SETTING, values);
  return includeArchived ? values : values.filter((category) => !category.archived);
}

export function activeCategories() { return listCategories(false); }

/** Created only after the user edits a previously unrecorded planned minute.
 * Source display colors do not expand the manual Google-only color picker. */
export function ensureSourceColorCategory(input: { color: string; name: string; calendarId: string;
  provider?: ActivityCategory['provider']; accountId?: string; preferredCategoryId?: string }): Promise<ActivityCategory> {
  return serialized(async () => {
    if (!COLOR.test(input.color)) throw new Error('The source event color is unavailable.');
    const categories = await listCategories();
    const sameColor = (category: ActivityCategory) => category.color.toUpperCase() === input.color.toUpperCase();
    const preferred = categories.find((category) => category.id === input.preferredCategoryId && sameColor(category));
    if (preferred) return preferred;
    const provider = input.provider ?? 'device';
    const identity = ['source-color', provider, input.accountId ?? '', input.calendarId, input.color.toUpperCase()];
    let id = stableId(...identity);
    const current = categories.find((category) => category.id === id && sameColor(category));
    if (current) return current;
    const matching = categories.filter((category) => sameColor(category) && category.provider === provider &&
      category.accountId === input.accountId && (!category.calendarId || category.calendarId === input.calendarId));
    if (matching.length === 1) return matching[0]!;
    // An older source-color entry may have been deliberately customized. Never
    // recolor that historical activity when recording a new source-colored note.
    let variant = 0;
    while (categories.some((category) => category.id === id)) id = stableId(...identity, `original-${++variant}`);
    const category: ActivityCategory = { id, name: input.name.trim().slice(0, 200) || 'Calendar activity', color: input.color,
      provider, calendarId: input.calendarId, ...(input.accountId ? { accountId: input.accountId } : {}),
      providerOriginalColor: input.color, providerOriginalName: input.name.trim().slice(0, 200) || 'Calendar activity',
      updatedAt: new Date().toISOString() };
    await writeCategory(category);
    await listCategories();
    return category;
  });
}

/** New activity choices use only Google-provided hex values. Old records are still
 * available through listCategories for history, reports, rename and archive. */
export type ActivityColorOptions = { writableOnly?: boolean; scope?: { dateKey: string; minuteIndex: number } };
export async function listSelectableActivityCategories(options: ActivityColorOptions = {}): Promise<ActivityCategory[]> {
  const categories = await listCategories();
  const historical = () => categories.filter((category) => !category.archived &&
    !(category.provider === 'google' && category.providerOriginalColor && category.color.toUpperCase() !== category.providerOriginalColor.toUpperCase()) &&
    isAllowedGoogleActivityColor(category.color, categories));
  if (options.writableOnly === false) return historical();
  const allWriters = await connectedGoogleWriters();
  for (const writer of allWriters) refreshPaletteInBackground(hashValue(['google-event-palette', writer.identity]),
    () => readGoogleWritablePalette(writer.account, writer.labelCalendars),
    async () => (await connectedGoogleWriters()).some((current) => current.identity === writer.identity));
  const preferences = await getSetting<Partial<CalendarPreferences>>('calendar.preferences', {});
  const selectedNativeIds = preferences.writeCalendarId ? [preferences.writeCalendarId] : preferences.selectedCalendarIds ?? [];
  if (selectedNativeIds.length) refreshPaletteInBackground(hashValue(['native-event-palette', [...selectedNativeIds].sort()]),
    () => readNativeWritablePalette(selectedNativeIds), async () => {
      const current = await getSetting<Partial<CalendarPreferences>>('calendar.preferences', {});
      const ids = current.writeCalendarId ? [current.writeCalendarId] : current.selectedCalendarIds ?? [];
      return hashValue([...ids].sort()) === hashValue([...selectedNativeIds].sort());
    });
  let writers = allWriters; let nativeIds = selectedNativeIds;
  if (options.scope && typeof getMinuteEntry === 'function' && typeof getSyncBindingsForBlock === 'function') {
    const entry = await getMinuteEntry(options.scope.dateKey, options.scope.minuteIndex);
    if (entry) {
      const owners = (await getSyncDocuments('projection:')).filter((document) => document.value?.state !== 'deleted' && document.value?.blockId === entry.blockId);
      const owner = owners.find((document) => allWriters.some((writer) => writer.account.id === document.value?.accountId));
      if (owner) {
        writers = allWriters.filter((writer) => writer.account.id === owner.value!.accountId)
          .map((writer) => ({ ...writer, labelCalendars: [String(owner.value!.calendarId)] })); nativeIds = [];
      } else if (!owners.length) {
        const bound = (await getSyncBindingsForBlock(entry.blockId)).filter((binding) => binding.calendarId === preferences.writeCalendarId);
        if (bound.length) { writers = []; nativeIds = [...new Set(bound.map((binding) => binding.calendarId))]; }
      }
    }
  }
  const writable = categories.filter((category) => category.googleColorVerified && (
    writers.some((writer) => category.provider === 'google' && category.accountId === writer.account.id &&
      (category.providerColorId || category.providerLabelId && writer.labelCalendars.includes(category.calendarId ?? ''))) ||
    category.provider === 'device' && category.providerColorId && nativeIds.includes(category.calendarId ?? '')) &&
      (!category.providerOriginalColor || category.providerOriginalColor.toUpperCase() === category.color.toUpperCase()));
  const writableColors = new Set(writable.map((category) => category.color.toUpperCase()));
  const restricted = writers.length > 0 || categories.some((category) => category.provider === 'device' &&
    category.googleColorVerified && category.providerColorId && nativeIds.includes(category.calendarId ?? ''));
  return historical().filter((category) => (!restricted || writableColors.has(category.color.toUpperCase())) &&
    // A local display override must not offer a color that its provider ID would
    // render differently. Keep the category readable for existing entries.
    !(category.provider === 'google' && category.providerOriginalColor &&
      (typeof category.providerOriginalColor !== 'string' ||
        category.color.toUpperCase() !== category.providerOriginalColor.toUpperCase())) &&
    isAllowedGoogleActivityColor(category.color, categories));
}

export async function listGoogleActivityColors(): Promise<string[]> {
  return googleActivityColorValues(await listCategories());
}

export function createCategory(input: { name: string; color: string }): Promise<ActivityCategory> {
  return serialized(async () => {
    const categories = await listCategories();
    if (!isAllowedGoogleActivityColor(input.color, categories)) {
      throw new Error('Choose a color from the Google Calendar palette.');
    }
    const category: ActivityCategory = { id: `custom_${Crypto.randomUUID().replaceAll('-', '')}`,
      name: input.name.trim(), color: input.color.toUpperCase(), updatedAt: new Date().toISOString() };
    await writeCategory(category);
    await listCategories();
    return category;
  });
}

export function updateCategory(id: string, changes: Partial<Pick<ActivityCategory, 'name' | 'color' | 'archived'>>): Promise<ActivityCategory> {
  return serialized(async () => {
    const categories = await listCategories();
    const existing = categories.find((category) => category.id === id);
    if (!existing) throw new Error('This category is no longer available.');
    if (changes.color !== undefined && (typeof changes.color !== 'string' ||
        (changes.color.toUpperCase() !== existing.color.toUpperCase() &&
          !isAllowedGoogleActivityColor(changes.color, categories)))) {
      throw new Error('Choose a color from the Google Calendar palette.');
    }
    const next = { ...existing, ...changes, name: (changes.name ?? existing.name).trim(),
      color: (changes.color ?? existing.color).toUpperCase(), updatedAt: new Date().toISOString() };
    await writeCategory(next);
    await listCategories();
    return next;
  });
}

function stableId(...parts: string[]) {
  return `import_${hashValue(parts).slice(0, 48)}`;
}

async function importCategories(values: ActivityCategory[]) {
  const existing = await listCategories();
  const byId = new Map(existing.map((category) => [category.id, category]));
  let added = 0;
  for (const category of values) {
    const current = byId.get(category.id);
    if (current) {
      // Refresh provider changes only where the user has not customized the local display.
      const next = { ...current, ...category, archived: current.archived,
        name: current.providerOriginalName && current.name === current.providerOriginalName ? category.name : current.name,
        color: current.providerOriginalColor && current.color === current.providerOriginalColor ? category.color : current.color,
        providerOriginalName: category.name, providerOriginalColor: category.color };
      const plain = (value: ActivityCategory) => JSON.parse(JSON.stringify(value));
      if (hashValue(plain(current)) !== hashValue(plain(next))) {
        await writeCategory({ ...next, updatedAt: new Date().toISOString() });
      }
      continue;
    }
    await writeCategory({ ...category, providerOriginalName: category.name,
      providerOriginalColor: category.color, updatedAt: new Date().toISOString() });
    byId.set(category.id, category);
    added += 1;
  }
  await listCategories();
  return added;
}

export function importDeviceCategories(calendars: DeviceCalendar[]) {
  return readNativeWritablePalette(calendars.map((calendar) => calendar.id)).then((palette) => serialized(() => importCategories([...calendars.map((calendar) => ({
    id: stableId('device', calendar.id), name: calendar.title, color: COLOR.test(calendar.color) ? calendar.color : '#96938C',
    provider: 'device' as const, calendarId: calendar.id,
  })), ...palette])));
}

// Graph defines 25 named presets; their exact rendered shades vary between Outlook clients.
const OUTLOOK_COLORS = [
  '#E74856', '#FF8C00', '#A0522D', '#FFCC00', '#47A447', '#00A6A6', '#7A8B30', '#0078D4', '#8764B8', '#C239B3',
  '#7A8E9A', '#4D6470', '#8A8886', '#605E5C', '#252423', '#A4262C', '#CA5010', '#7E4A35', '#986F0B', '#107C10',
  '#038387', '#5E6C23', '#004578', '#5C2D91', '#881798',
];

async function providerJson(account: ConnectedAccount, url: string) {
  const response = await accountFetch(account, url);
  if (!response.ok) {
    if (response.status === 403) throw new Error('Allow category reading for this account, then reconnect and import its categories.');
    throw new Error(`The account category request failed (${response.status}).`);
  }
  return response.json();
}

export async function importAccountCategories(account: ConnectedAccount): Promise<{ added: number; note: string }> {
  // Fetch outside the local mutation queue. A slow provider must not prevent a
  // minute save (or a clipboard command flushing that minute) from preparing its color.
    if (!account.consent.calendarRead || account.provider === 'webdav') {
      throw new Error('Connect an account with calendar reading enabled first.');
    }
    const imported: ActivityCategory[] = [];
    const calendars = await createCalendarAdapter(account).listCalendars();
    for (const calendar of calendars) {
      // An absent Google value must not approve an invented fallback color.
      const color = account.provider === 'google' ? calendar.providedColor : calendar.color;
      if (account.provider === 'google' && (typeof color !== 'string' || !COLOR.test(color))) continue;
      imported.push({
        id: stableId(account.id, 'calendar', calendar.id), name: calendar.title,
        color: typeof color === 'string' && COLOR.test(color) ? color : '#96938C', provider: account.provider,
        accountId: account.id, calendarId: calendar.id,
        ...(account.provider === 'google' ? { googleColorVerified: true } : {}),
      });
    }
    let note = '';
    if (account.provider === 'google') {
      const palette = await providerJson(account, 'https://www.googleapis.com/calendar/v3/colors');
      for (const [id, definition] of Object.entries(palette.event ?? {})) {
        const color = (definition as { background?: string }).background;
        if (color && COLOR.test(color)) imported.push({ id: stableId(account.id, 'color', id),
          name: `Google event color ${id}`, color, provider: 'google', accountId: account.id, providerColorId: id,
          googleColorVerified: true });
      }
      for (const [id, definition] of Object.entries(palette.calendar ?? {})) {
        const color = (definition as { background?: string }).background;
        if (color && COLOR.test(color)) imported.push({ id: stableId(account.id, 'calendarColor', id),
          name: `Google calendar color ${id}`, color, provider: 'google', accountId: account.id, googleColorVerified: true });
      }
      // Modern Google calendars may expose up to 200 named event labels per calendar.
      for (const calendar of (account.consent as { categoryRead?: boolean }).categoryRead ? calendars : []) {
        let metadata;
        try {
          metadata = await providerJson(account,
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}?eventLabelVersion=1`);
        } catch {
          note = 'Some calendar labels were unavailable. Accessible labels and calendar colors were imported.';
          continue;
        }
        for (const label of metadata.labelProperties?.eventLabels ?? []) {
          if (typeof label.id === 'string' && COLOR.test(label.backgroundColor ?? '')) imported.push({
            id: stableId(account.id, calendar.id, label.id), name: label.name || `Google label ${label.id}`,
            color: label.backgroundColor, provider: 'google', accountId: account.id,
            calendarId: calendar.id, providerLabelId: label.id,
            googleColorVerified: true,
          });
        }
      }
      if (!(account.consent as { categoryRead?: boolean }).categoryRead) {
        note = 'Event palette and calendar colors imported. Enable category reading to import all named Google calendar labels too.';
      }
    } else if ((account.consent as { categoryRead?: boolean }).categoryRead) {
      let url: string | null = 'https://graph.microsoft.com/v1.0/me/outlook/masterCategories';
      const visited = new Set<string>();
      while (url) {
        if (visited.has(url)) throw new Error('Microsoft returned a repeated category page.');
        visited.add(url);
        const page = await providerJson(account, url);
        for (const category of page.value ?? []) {
          const preset = /^preset(\d+)$/i.exec(category.color ?? '');
          if (typeof category.id !== 'string' || typeof category.displayName !== 'string') continue;
          imported.push({ id: stableId(account.id, category.id), name: category.displayName,
            color: preset ? OUTLOOK_COLORS[Number(preset[1])] ?? '#96938C' : '#96938C',
            provider: 'microsoft', accountId: account.id, providerCategoryName: category.displayName,
            providerColorId: category.color });
        }
        url = page['@odata.nextLink'] ?? null;
      }
    } else note = 'Calendar colors imported. Enable Outlook category reading to import your named master categories too.';
    return serialized(async () => ({ added: await importCategories(imported), note }));
}

export type ProviderCategoryColor = {
  colorId?: string;
  eventLabelId?: string;
  categoryName?: string;
};

/** A provider mapping is used only in the account/calendar where that mapping exists. */
export function categoryProviderColor(categoryId: string, provider: AccountProvider,
  accountId: string, calendarId?: string): ProviderCategoryColor {
  const category = CATEGORIES.find((item) => item.id === categoryId);
  if (!category) return {};
  if (provider === 'google') {
    const direct = category.provider === 'google' && category.accountId === accountId &&
      (!category.providerOriginalColor || category.providerOriginalColor.toUpperCase() === category.color.toUpperCase());
    if (direct && category.providerLabelId && calendarId === category.calendarId) return { eventLabelId: category.providerLabelId };
    if (direct && category.providerColorId) return { colorId: category.providerColorId };
    // Labels belong to one calendar. A same-account label from another calendar
    // may still use an independently verified exact event/target-label shade.
    const matching = CATEGORIES.find((item) => {
      const original = item.providerOriginalColor ?? item.color;
      return item.provider === 'google' && item.accountId === accountId && typeof original === 'string' &&
        original.toUpperCase() === category.color.toUpperCase() &&
        (item.providerColorId || (item.providerLabelId && item.calendarId === calendarId));
    });
    if (matching) return matching.providerLabelId && matching.calendarId === calendarId
      ? { eventLabelId: matching.providerLabelId } : { colorId: matching.providerColorId };
    return {};
  }
  if (category.provider !== provider || category.accountId !== accountId) return {};
  if (provider === 'microsoft' && category.providerCategoryName) return { categoryName: category.providerCategoryName };
  return {};
}

export function categoryForProviderColor(provider: AccountProvider, accountId: string, calendarId: string,
  value: { colorId?: string; eventLabelId?: string; categoryNames?: string[] }) {
  return CATEGORIES.find((category) => category.provider === provider && category.accountId === accountId &&
    ((provider === 'google' && Boolean(
      (value.eventLabelId && category.calendarId === calendarId && category.providerLabelId === value.eventLabelId) ||
      (!value.eventLabelId && value.colorId && category.providerColorId === value.colorId))) ||
     (provider === 'microsoft' && category.providerCategoryName && value.categoryNames?.includes(category.providerCategoryName))))?.id;
}
