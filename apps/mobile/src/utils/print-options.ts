import type { ReportPeriod } from '../services/reports';
import { dashboardPeriodDates } from './dashboard';
import { isDateKey, normalizeSelectedDates } from './date-selection';
import { addDays, dateKey, parseDateKey } from './time';

export type PrintAction = 'print' | 'save';
export type PrintView = 'day' | 'week' | 'month' | 'schedule' | 'dashboard';
export type PrintColorStyle = 'outline' | 'full-color' | 'grayscale' | 'black-white';
export type ContextPrintOptions = {
  startDate: string;
  endDate: string;
  view: PrintView;
  orientation: 'portrait' | 'landscape';
  colorStyle: PrintColorStyle;
  showWeekends: boolean;
  includeStartEndTimes: boolean;
  includeDescriptions: boolean;
  dashboardPeriod: ReportPeriod | 'custom';
  percentageBasis: 'recorded' | 'period';
  dashboardMetric: 'recorded' | 'unrecorded';
};

const serial = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000;

export function defaultPrintOptions(value: readonly string[], requestedView = 'schedule'): ContextPrintOptions {
  const dates = normalizeSelectedDates(value);
  const first = dates[0] ?? dateKey(new Date());
  const requestedLast = dates.at(-1) ?? first;
  const last = serial(requestedLast) - serial(first) > 365 ? dateKey(addDays(first, 365)) : requestedLast;
  const view: PrintView = requestedView === 'year' ? 'month' :
    ['day', 'week', 'month', 'schedule', 'dashboard'].includes(requestedView) ? requestedView as PrintView : 'day';
  return { startDate: first, endDate: last, view, orientation: view === 'week' || view === 'month' ? 'landscape' : 'portrait',
    colorStyle: 'outline', showWeekends: true, includeStartEndTimes: true, includeDescriptions: true,
    dashboardPeriod: 'custom', percentageBasis: 'recorded', dashboardMetric: 'recorded' };
}

export function normalizePrintOptions(value: ContextPrintOptions): ContextPrintOptions {
  if (!value || !isDateKey(value.startDate) || !isDateKey(value.endDate) || value.endDate < value.startDate) {
    throw new Error('Choose a valid start and end date.');
  }
  if (serial(value.endDate) - serial(value.startDate) + 1 > 366) throw new Error('Choose a print range of at most 366 days.');
  if (!['day', 'week', 'month', 'schedule', 'dashboard'].includes(value.view) ||
      !['portrait', 'landscape'].includes(value.orientation) ||
      !['outline', 'full-color', 'grayscale', 'black-white'].includes(value.colorStyle) ||
      !['day', 'week', 'month', 'year', 'custom'].includes(value.dashboardPeriod) ||
      !['recorded', 'period'].includes(value.percentageBasis) ||
      !['recorded', 'unrecorded'].includes(value.dashboardMetric) ||
      [value.showWeekends, value.includeStartEndTimes, value.includeDescriptions].some((item) => typeof item !== 'boolean')) {
    throw new Error('Choose valid print options.');
  }
  return { startDate: value.startDate, endDate: value.endDate, view: value.view, orientation: value.orientation,
    colorStyle: value.colorStyle, showWeekends: value.showWeekends, includeStartEndTimes: value.includeStartEndTimes,
    includeDescriptions: value.includeDescriptions, dashboardPeriod: value.dashboardPeriod,
    percentageBasis: value.percentageBasis, dashboardMetric: value.dashboardMetric };
}

/** Print ranges are inclusive civil dates, independent of 23/25-hour DST days. */
export function printOptionDates(value: ContextPrintOptions): string[] {
  const options = normalizePrintOptions(value);
  const count = serial(options.endDate) - serial(options.startDate) + 1;
  const days = Array.from({ length: count }, (_, index) => dateKey(addDays(options.startDate, index)))
    .filter((day) => options.showWeekends || ![0, 6].includes(parseDateKey(day).getDay()));
  if (!days.length) throw new Error('No weekdays are included. Show weekends or choose another date range.');
  return days;
}

export function withDashboardPeriod(value: ContextPrintOptions, period: ReportPeriod): ContextPrintOptions {
  const options = normalizePrintOptions(value);
  if (!['day', 'week', 'month', 'year'].includes(period)) throw new Error('Choose a Dashboard period.');
  const dates = dashboardPeriodDates(options.startDate, period);
  return normalizePrintOptions({ ...options, startDate: dates[0]!, endDate: dates.at(-1)!, dashboardPeriod: period });
}
