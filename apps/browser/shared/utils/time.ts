export const MINUTES_PER_DAY = 24 * 60;

export function pad2(value: number) {
  return value.toString().padStart(2, '0');
}

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseDateKey(value: string) {
  const [year = 1970, month = 1, day = 1] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function addDays(value: Date | string, amount: number) {
  const source = typeof value === 'string' ? parseDateKey(value) : value;
  const next = new Date(source);
  next.setDate(next.getDate() + amount);
  return next;
}

export function minuteLabel(minuteIndex: number, includeMeridiem = false) {
  const hours = Math.floor(minuteIndex / 60);
  const minutes = minuteIndex % 60;
  if (!includeMeridiem) return `${pad2(hours)}:${pad2(minutes)}`;
  const meridiem = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${pad2(minutes)} ${meridiem}`;
}

export function minuteIndexForDate(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

export function localDateAtMinute(value: string, minuteIndex: number) {
  const date = parseDateKey(value);
  date.setHours(Math.floor(minuteIndex / 60), minuteIndex % 60, 0, 0);
  return date;
}

export function formatDayHeading(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(parseDateKey(value));
}

export function formatCompactDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parseDateKey(value));
}

export function startOfWeek(date: Date, firstDay = 1) {
  const result = new Date(date);
  const difference = (result.getDay() - firstDay + 7) % 7;
  result.setDate(result.getDate() - difference);
  result.setHours(12, 0, 0, 0);
  return result;
}

export function isSameLocalDay(left: Date, right: Date) {
  return dateKey(left) === dateKey(right);
}

export function calendarMinuteRange(eventStart: Date, eventEnd: Date, day: string) {
  const dayStart = parseDateKey(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  if (eventEnd <= dayStart || eventStart >= dayEnd) return null;

  const startMinute = eventStart <= dayStart ? 0 : minuteIndexForDate(eventStart);
  const endMinuteExclusive = eventEnd >= dayEnd ? MINUTES_PER_DAY : minuteIndexForDate(eventEnd);
  return {
    startMinute,
    endMinuteExclusive: Math.max(startMinute + 1, endMinuteExclusive),
  };
}
