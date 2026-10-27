import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { compactCalendarMinuteLog, type CompactMinuteLayout } from './calendar-minute-log';

type DescriptionLogBase = {
  offset: number;
  prefixHash: string;
  logHash: string;
};
export type DescriptionLog = DescriptionLogBase & ({ version: 1 | 2 } | ({ version: 3 } & CompactMinuteLayout));

const MAX_OFFSET = 2_000_000;
const BEGIN_LOG = '--- Context minutes ---';
const END_LOG = '--- End Context minutes ---';
const REVIEW_MESSAGE = 'This calendar description changed outside its minute log. Review it before synchronizing.';
const hash = (value: string) => bytesToHex(sha256(utf8ToBytes(value)));
const reviewError = () => new Error(REVIEW_MESSAGE);

export function isDescriptionLog(value: unknown): value is DescriptionLog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = Object.keys(value);
  const candidate = value as Record<string, unknown>;
  const compact = candidate.version === 3;
  const allowed = ['version', 'offset', 'prefixHash', 'logHash', ...(compact ? ['minuteMask', 'startsHash'] : [])];
  if (fields.length !== allowed.length || fields.some((key) => !allowed.includes(key))) return false;
  return (candidate.version === 1 || candidate.version === 2 || compact) &&
    (!compact || typeof candidate.minuteMask === 'string' && /^[a-f0-9]{360}$/.test(candidate.minuteMask) &&
      typeof candidate.startsHash === 'string' && /^[a-f0-9]{64}$/.test(candidate.startsHash)) && typeof candidate.offset === 'number' &&
    Number.isSafeInteger(candidate.offset) && candidate.offset >= 0 && candidate.offset <= MAX_OFFSET &&
    typeof candidate.prefixHash === 'string' && /^[a-f0-9]{64}$/.test(candidate.prefixHash) &&
    typeof candidate.logHash === 'string' && /^[a-f0-9]{64}$/.test(candidate.logHash);
}

export function makeCompactCalendarDescription(preserved: string,
  entries: readonly { dateKey: string; minuteIndex: number; text: string }[], includeMeridiem = true):
  { description: string; descriptionLog: DescriptionLog & { version: 3 } } {
  const compact = compactCalendarMinuteLog(entries, includeMeridiem);
  const ordinary = makeCalendarDescription(preserved, compact.log, 2);
  return { description: ordinary.description,
    descriptionLog: { ...ordinary.descriptionLog, version: 3, minuteMask: compact.minuteMask, startsHash: compact.startsHash } };
}

/** Ownership lives in provider metadata; the visible description contains only the
 * original text followed by timestamped notes. Original whitespace is significant. */
export function makeCalendarDescription(preserved: string, minuteLog: string, version: 1 | 2 = 1): {
  description: string; descriptionLog: DescriptionLog;
} {
  const offset = preserved.length ? preserved.length + 2 : 0;
  if (offset > MAX_OFFSET) throw new Error('This calendar description is too long to synchronize safely.');
  return {
    description: preserved.length ? `${preserved}\n\n${minuteLog}` : minuteLog,
    descriptionLog: { version, offset, prefixHash: hash(preserved), logHash: hash(minuteLog) },
  };
}

type DescriptionEvent = { description: string; descriptionLog?: DescriptionLog; projectionId?: string };
type DescriptionParts = { preserved: string; log: string | null; format: 'clean' | 'legacy' | 'original' };
type Line = { start: number; end: number; next: number; text: string };

function descriptionLines(value: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start < value.length) {
    const lf = value.indexOf('\n', start);
    const next = lf < 0 ? value.length : lf + 1;
    const end = lf < 0 ? value.length : (lf > start && value[lf - 1] === '\r' ? lf - 1 : lf);
    lines.push({ start, end, next, text: value.slice(start, end) });
    start = next;
  }
  return lines;
}

function stripLegacyBody(body: string, expectedProjectionId: string) {
  const lines = descriptionLines(body);
  let first = 0;
  let last = lines.length;
  if (lines[0]?.text.startsWith('Context category: ')) first += 1;
  if (last > first && lines[last - 1]?.text === `Context projection: ${expectedProjectionId}`) last -= 1;
  if (first === last) return '';
  return body.slice(lines[first]!.start, lines[last - 1]!.end);
}

function stripLegacyJoin(before: string, after: string) {
  // The old writer added exactly one double newline between original text and
  // its block. Remove only that join, never trim the user's original whitespace.
  if (before.endsWith('\r\n\r\n')) return before.slice(0, -4) + after;
  if (before.endsWith('\n\n')) return before.slice(0, -2) + after;
  if (!before && after.startsWith('\r\n\r\n')) return after.slice(4);
  if (!before && after.startsWith('\n\n')) return after.slice(2);
  return before + after;
}

export function readCalendarDescription(event: DescriptionEvent, expectedProjectionId: string): DescriptionParts {
  const original = (): DescriptionParts => ({ preserved: event.description, log: null, format: 'original' });
  const ownsEvent = Boolean(expectedProjectionId) && event.projectionId === expectedProjectionId;
  if (ownsEvent && event.descriptionLog !== undefined) {
    if (!isDescriptionLog(event.descriptionLog)) throw reviewError();
    // Clearing the visible description is an intentional provider edit, even
    // when its previous private offset still points beyond the now-empty text.
    if (event.description === '') return { preserved: '', log: '', format: 'clean' };
    const { offset, prefixHash } = event.descriptionLog;
    if (offset > event.description.length || (offset > 0 &&
        (offset < 2 || event.description.slice(offset - 2, offset) !== '\n\n'))) throw reviewError();
    const preserved = offset === 0 ? '' : event.description.slice(0, offset - 2);
    if (hash(preserved) !== prefixHash) throw reviewError();
    // A changed tail is a supported calendar edit. logHash records the previous
    // generated value; it must not prevent importing the user's edited notes.
    return { preserved, log: event.description.slice(offset), format: 'clean' };
  }
  // A large unrelated description remains byte-for-byte original. Bounded legacy
  // scanning is only a migration aid, never a reason to infer timestamp ownership.
  if (event.description.length > MAX_OFFSET) {
    if (ownsEvent) throw reviewError();
    return original();
  }
  if (!expectedProjectionId || /[\r\n]/.test(expectedProjectionId)) return original();
  const lines = descriptionLines(event.description);
  const begins = lines.filter((line) => line.text === BEGIN_LOG);
  const ends = lines.filter((line) => line.text === END_LOG);
  const expectedMarker = `Context projection: ${expectedProjectionId}`;
  const begin = begins[0];
  const end = ends[0];
  if (!begin || !end || end.start < begin.start) {
    if (ownsEvent && (begins.length || ends.length)) throw reviewError();
    return original();
  }
  const ownsBlock = ownsEvent || lines.some((line) => line.start >= begin.next &&
    line.end <= end.start && line.text === expectedMarker);
  if (!ownsBlock) return original();
  // Duplicate/nested delimiters cannot be attributed safely to one generated log.
  if (begins.length !== 1 || ends.length !== 1) throw reviewError();
  const bodyEnd = end.start > begin.next && event.description[end.start - 1] === '\n'
    ? end.start - (event.description[end.start - 2] === '\r' ? 2 : 1) : end.start;
  const body = event.description.slice(begin.next, bodyEnd);
  return {
    preserved: stripLegacyJoin(event.description.slice(0, begin.start), event.description.slice(end.end)),
    log: stripLegacyBody(body, expectedProjectionId), format: 'legacy',
  };
}
