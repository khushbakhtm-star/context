import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { calendarColorRequest, calendarColorValues } from './src/values';

type NativeColors = {
  getEventColorsAsync(calendarIds: string[], startMs: number, endMs: number): Promise<unknown>;
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
