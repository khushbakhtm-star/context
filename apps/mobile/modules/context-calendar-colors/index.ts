import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { calendarColorRequest, calendarColorValues, eventColorWriteRequest, eventPaletteValues,
  type EventColorWrite, type EventPaletteColor } from './src/values';
export type { EventColorWrite, EventPaletteColor } from './src/values';

type NativeColors = {
  getEventColorsAsync(calendarIds: string[], startMs: number, endMs: number): Promise<unknown>;
  getEventPaletteAsync(calendarIds: string[]): Promise<unknown>;
  setEventColorAsync(calendarId: string, eventId: string, color: string, expectedColor: string,
    startMs: number, endMs: number, title: string, notes: string): Promise<unknown>;
};

/** Best-effort display data only. Existing calendar permission and calendar selection apply. */
export async function getEventColorsAsync(calendarIds: readonly string[], startMs: number, endMs: number): Promise<Record<string, string>> {
  if (Platform.OS !== 'android') return {};
  const request = calendarColorRequest(calendarIds, startMs, endMs);
  if (!request?.calendarIds.length) return {};
  try {
    const native = requireOptionalNativeModule<NativeColors>('ContextCalendarColors');
    if (!native) return {};
    return calendarColorValues(await native.getEventColorsAsync(request.calendarIds, request.startMs, request.endMs));
  } catch { return {}; }
}

/** Exact writable Google event palette from selected phone calendars; no account identity is exported. */
export async function getEventPaletteAsync(calendarIds: readonly string[]): Promise<EventPaletteColor[]> {
  if (Platform.OS !== 'android') return [];
  const request = calendarColorRequest(calendarIds, 0, 1);
  if (!request?.calendarIds.length) return [];
  const native = requireOptionalNativeModule<NativeColors>('ContextCalendarColors');
  if (!native?.getEventPaletteAsync) return [];
  return eventPaletteValues(await native.getEventPaletteAsync(request.calendarIds), request.calendarIds);
}

/** Explicit guarded write only. Unsupported/missing native support is never acknowledged as success. */
export async function setEventColorAsync(input: EventColorWrite): Promise<{ color: string; changed: boolean }> {
  const request = eventColorWriteRequest(input);
  if (!request) throw new Error('The linked event color request is invalid.');
  if (Platform.OS !== 'android') throw new Error('Event color writeback is unavailable for this phone calendar.');
  const native = requireOptionalNativeModule<NativeColors>('ContextCalendarColors');
  if (!native?.setEventColorAsync) throw new Error('Update Context to enable linked event color writeback.');
  const result = await native.setEventColorAsync(request.calendarId, request.eventId, request.color, request.expectedColor,
    request.startMs, request.endMs, request.title, request.notes);
  if (!result || typeof result !== 'object' || !('color' in result) || !('changed' in result) ||
      result.color !== request.color || typeof result.changed !== 'boolean') {
    throw new Error('The calendar did not confirm the selected event color.');
  }
  return { color: result.color, changed: result.changed };
}
