import { AppState, Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { getDaySegments } from '../data/database';
import { getAccounts } from '../sync/accounts';
import { getAccountPreferences, loadAccountPlans } from '../sync/engine';
import { createCalendarAdapter } from '../sync/providers';
import type { ConnectedAccount } from '../sync/types';
import type { CalendarPreferences, DeviceCalendar } from '../types';
import { createPrintCalendarDocument, renderDashboardPrint } from '../utils/print-calendar';
import { normalizePrintOptions, printOptionDates, type ContextPrintOptions, type PrintAction } from '../utils/print-options';
import { printScheduleDates } from '../utils/print-schedule';
import { scheduleAgendaItems } from '../utils/schedule-agenda';
import { formatDayHeading } from '../utils/time';
import { getCalendarPermissionStatus, listDeviceCalendars, loadPlannedEventsResult } from './calendar';
import { inlineMinuteDrafts } from './inline-minutes';
import { getDashboardSummary } from './dashboard';

export type PrintContextScheduleOptions = {
  /** Kept for callers displaying the resolved range; validated options determine the actual export scope. */
  dates?: readonly string[];
  options: ContextPrintOptions;
  action: PrintAction;
  calendars: readonly DeviceCalendar[];
  preferences: CalendarPreferences;
  clockFormat: '12h' | '24h';
  signal?: AbortSignal;
};
export type PrintContextScheduleResult = { status: 'opened' | 'cancelled'; dayCount: number };
class PrintPreparationCancelled extends Error {}
let printInProgress = false;

/** Creates a local PDF, then opens the chosen system dialog. It never selects a printer or reports a file as saved. */
export async function printContextSchedule(options: PrintContextScheduleOptions): Promise<PrintContextScheduleResult> {
  const printOptions = normalizePrintOptions(options.options);
  const dates = printScheduleDates(printOptionDates(printOptions));
  if (options.action !== 'print' && options.action !== 'save') throw new Error('Choose Print or Save PDF.');
  if (options.clockFormat !== '12h' && options.clockFormat !== '24h') throw new Error('Choose a valid time format before printing.');
  if (options.signal?.aborted || AppState.currentState !== 'active') return { status: 'cancelled', dayCount: dates.length };
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') throw new Error('Printing is available in the Android and iOS apps.');
  if (printInProgress) throw new Error('A print request is already in progress.');
  printInProgress = true;
  const calendars = options.calendars.map((calendar) => ({ ...calendar }));
  const selectedCalendarIds = [...new Set(options.preferences.selectedCalendarIds)];
  let cancelled = false;
  let rejectCancellation: ((reason: PrintPreparationCancelled) => void) | null = null;
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const cancel = () => { cancelled = true; rejectCancellation?.(new PrintPreparationCancelled()); };
  const checkCancelled = () => {
    if (cancelled || options.signal?.aborted || AppState.currentState !== 'active') throw new PrintPreparationCancelled();
  };
  options.signal?.addEventListener('abort', cancel, { once: true });
  const appState = AppState.addEventListener('change', (state) => { if (state !== 'active') cancel(); });
  let listening = true;
  const stopListening = () => {
    if (!listening) return;
    listening = false;
    options.signal?.removeEventListener('abort', cancel); appState.remove();
  };

  type AccountSource = { account: ConnectedAccount; calendarIds: string[] };
  const readAccountSources = async (): Promise<AccountSource[]> => {
    const accounts = await getAccounts();
    checkCancelled();
    const sources: AccountSource[] = [];
    for (const account of accounts) {
      if (!account.consent.calendarRead) continue;
      const preferences = await getAccountPreferences(account.id);
      checkCancelled();
      sources.push({ account: { ...account, consent: { ...account.consent } },
        calendarIds: [...new Set(preferences.selectedCalendarIds)].sort() });
    }
    return sources;
  };
  const sourceFingerprint = (sources: AccountSource[]) => JSON.stringify(sources.map(({ account, calendarIds }) => ({
    id: account.id, provider: account.provider, subject: account.subject, calendarIds,
  })).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const checkAccountAvailability = async (sources: AccountSource[]) => {
    for (const { account, calendarIds } of sources) {
      checkCancelled();
      if (!calendarIds.length) continue;
      const available = await createCalendarAdapter(account).listCalendars();
      checkCancelled();
      if (calendarIds.some((id) => !available.some((calendar) => calendar.id === id))) {
        throw new Error('A selected account calendar is unavailable. Check the calendar selection in Settings before printing.');
      }
    }
  };
  const checkNativeAvailability = async () => {
    if (!selectedCalendarIds.length) return;
    const permission = await getCalendarPermissionStatus();
    checkCancelled();
    if (permission !== 'granted') throw new Error('Calendar access changed. Check calendar access in Settings before printing.');
    const available = await listDeviceCalendars();
    checkCancelled();
    if (selectedCalendarIds.some((id) => !available.some((calendar) => calendar.id === id))) {
      throw new Error('A selected calendar is unavailable. Check the calendar selection in Settings before printing.');
    }
    // A permission may be revoked while the native calendar list is being read.
    const currentPermission = await getCalendarPermissionStatus();
    checkCancelled();
    if (currentPermission !== 'granted') throw new Error('Calendar access changed. Check calendar access in Settings before printing.');
  };

  let revalidateCalendarSources: (() => Promise<void>) | null = null;
  const prepareHtml = async () => {
    checkCancelled();
    // The caller saves before navigating to Print. Preparation itself is read-only.
    if (inlineMinuteDrafts.snapshot().some((draft) => draft.error || draft.savedRevision !== draft.revision)) {
      throw new Error('Your current minute could not be saved. Try again before printing.');
    }
    if (options.action === 'save') {
      const available = await Sharing.isAvailableAsync();
      checkCancelled();
      if (!available) throw new Error('PDF saving is unavailable on this device.');
    }
    if (printOptions.view === 'dashboard') {
      const summary = await getDashboardSummary(dates, { signal: options.signal });
      checkCancelled();
      return renderDashboardPrint(summary, options.clockFormat, printOptions);
    }
    if (selectedCalendarIds.some((id) => !calendars.some((calendar) => calendar.id === id))) {
      throw new Error('A selected calendar is unavailable. Check the calendar selection in Settings before printing.');
    }
    // Account reads otherwise skip missing/revoked sources. Capture the expected source set before reading days.
    const accountSources = await readAccountSources();
    const expectedSources = sourceFingerprint(accountSources);
    revalidateCalendarSources = async () => {
      const currentSources = await readAccountSources();
      checkCancelled();
      if (sourceFingerprint(currentSources) !== expectedSources) {
        throw new Error('The selected calendar accounts changed. Try printing again with the current calendar selection.');
      }
      // Re-list after preparation: deletion can happen without changing saved selections.
      await checkAccountAvailability(currentSources);
      checkCancelled();
      await checkNativeAvailability();
      checkCancelled();
      const finalSources = await readAccountSources();
      checkCancelled();
      if (sourceFingerprint(finalSources) !== expectedSources) {
        throw new Error('The selected calendar accounts changed. Try printing again with the current calendar selection.');
      }
    };
    await checkAccountAvailability(accountSources);
    checkCancelled();
    await checkNativeAvailability();
    checkCancelled();
    const document = createPrintCalendarDocument(dates, options.clockFormat, printOptions);
    let index = 0;
    let failed = false;
    const readDays = async () => {
      while (!failed) {
        checkCancelled();
        const day = dates[index++];
        if (!day) return;
        try {
          const [segments, device, accountPlans] = await Promise.all([
            getDaySegments(day), loadPlannedEventsResult(selectedCalendarIds, day, calendars), loadAccountPlans(day),
          ]);
          checkCancelled();
          if (device.failures.length || segments.some((segment) => segment.dateKey !== day ||
            !Number.isInteger(segment.startMinute) || !Number.isInteger(segment.endMinute) ||
            segment.startMinute < 0 || segment.endMinute > 1439 || segment.startMinute > segment.endMinute) ||
            [...device.plans, ...accountPlans].some((plan) => !Number.isFinite(plan.startDate.getTime()) ||
              !Number.isFinite(plan.endDate.getTime()) || plan.endDate <= plan.startDate)) {
            throw new Error('A calendar source returned incomplete data.');
          }
          document.addDay(day, scheduleAgendaItems(day, segments, [...device.plans, ...accountPlans]));
        } catch (error) {
          failed = true;
          if (error instanceof PrintPreparationCancelled) throw error;
          if (error instanceof Error && /print document is too large/.test(error.message)) throw error;
          throw new Error(`Some activities or calendar events could not load for ${formatDayHeading(day)}. Try again before printing.`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, dates.length) }, readDays));
    checkCancelled();
    await revalidateCalendarSources();
    checkCancelled();
    return document.finish();
  };
  const prepare = async () => {
    const html = await prepareHtml();
    checkCancelled();
    const landscape = printOptions.orientation === 'landscape';
    const pdf = await Print.printToFileAsync({ html, width: landscape ? 792 : 612, height: landscape ? 612 : 792 });
    checkCancelled();
    if (!pdf || typeof pdf.uri !== 'string' || !/^file:\/\/\/[^?#\u0000-\u001f]+\.pdf$/i.test(pdf.uri) ||
      !Number.isSafeInteger(pdf.numberOfPages) || pdf.numberOfPages < 1) {
      throw new Error('The PDF could not be prepared. Try again.');
    }
    // Generating a long PDF is asynchronous too; permissions/source selections can change while it renders.
    if (revalidateCalendarSources) await revalidateCalendarSources();
    checkCancelled();
    return pdf.uri;
  };
  try {
    // All worker promises have rejection handlers through prepare/Promise.all even after cancellation wins.
    const uri = await Promise.race([prepare(), cancellation]);
    checkCancelled();
    stopListening();
    // Once handoff starts, cancellation belongs to the system dialog, not the preparation control.
    if (options.action === 'save') {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      return { status: 'opened', dayCount: dates.length };
    }
    try { await Print.printAsync({ uri, orientation: printOptions.orientation }); }
    catch (error) {
      // Expo Print 58.0.7's iOS completion handler emits PrintIncompleteException when its dialog closes without printing.
      if (Platform.OS === 'ios' && typeof error === 'object' && error !== null && 'code' in error &&
        error.code === 'ERR_PRINT_INCOMPLETE') return { status: 'cancelled', dayCount: dates.length };
      throw error;
    }
    return { status: 'opened', dayCount: dates.length };
  } catch (error) {
    cancelled = true;
    if (error instanceof PrintPreparationCancelled) return { status: 'cancelled', dayCount: dates.length };
    throw error;
  } finally {
    cancelled = true;
    stopListening();
    printInProgress = false;
  }
}
