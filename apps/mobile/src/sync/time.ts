const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string) {
  let value = formatters.get(zone);
  if (!value) {
    value = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    formatters.set(zone, value);
  }
  return value;
}

function civilAt(instant: number, zone: string) {
  const parts = formatter(zone).formatToParts(new Date(instant));
  const part = (name: string) => Number(parts.find((item) => item.type === name)!.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
}

/** Resolve a civil label in its captured IANA zone, including offset changes within a block. */
export function zonedMinuteToInstant(day: string, minute: number, zone: string) {
  const target = Date.parse(`${day}T00:00:00Z`) + minute * 60000;
  if (!Number.isFinite(target)) throw new Error('This activity has an invalid civil date.');
  const offsets = new Set<number>();
  for (const delta of [-86400000, 0, 86400000]) {
    const probe = target + delta;
    offsets.add(civilAt(probe, zone) - probe);
  }
  const candidates = [...offsets].map((offset) => target - offset)
    .filter((instant) => civilAt(instant, zone) === target);
  if (candidates.length !== 1) {
    throw new Error(candidates.length ?
      'This endpoint is in the repeated daylight-saving hour. Choose an unambiguous minute before syncing.' :
      'This minute does not exist in the activity’s time zone because the clocks moved forward.');
  }
  return new Date(candidates[0]!).toISOString();
}
