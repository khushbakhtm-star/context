import { accountFetch, getAccounts } from './accounts';
import { isDescriptionLog, readCalendarDescription, type DescriptionLog } from '../utils/calendar-description';
import type {
  AccountCalendar,
  AccountCalendarAdapter,
  CalendarEventWrite,
  ConnectedAccount,
  RemoteCalendarEvent,
} from './types';

const GOOGLE = 'https://www.googleapis.com/calendar/v3';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const META_PROPERTY = 'String {7814848a-5a74-4c81-a7fe-3b962eaa0716} Name ContextMetadata';
const SOURCE_OPERATION_PROPERTY = 'String {7814848a-5a74-4c81-a7fe-3b962eaa0716} Name ContextSourceOperation';
// Keep Microsoft's raw HTML meeting blob available on reads and write responses. The engine
// receives a plain-text view separately; it must never replace the provider's join-meeting blob.
const GRAPH_PREFER = 'IdType="ImmutableId", outlook.timezone="UTC"';
const META_EXPAND = `singleValueExtendedProperties($filter=id eq '${META_PROPERTY}')`;
const HTML_LOG_START = '<!-- context-minute-ledger:start -->';
const HTML_LOG_END = '<!-- context-minute-ledger:end -->';

type JsonObject = Record<string, any>;

const metadataCacheBrand: unique symbol = Symbol('ContextCalendarMetadataReadCache');
export type CalendarMetadataReadCache = { readonly [metadataCacheBrand]: true };
const metadataCaches = new WeakMap<CalendarMetadataReadCache, Map<string, Promise<JsonObject>>>();
const MAX_METADATA_READS = 128;

/** One sync pass owns this handle. No event, version, write or permission result is cached. */
export function createCalendarMetadataReadCache(): CalendarMetadataReadCache {
  const cache: CalendarMetadataReadCache = Object.freeze({ [metadataCacheBrand]: true });
  metadataCaches.set(cache, new Map());
  return cache;
}

function detachedMetadata(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

async function readGoogleMetadata(account: ConnectedAccount, url: string,
  cache?: CalendarMetadataReadCache): Promise<JsonObject> {
  const read = () => accountFetch(account, url).then(expectJson);
  if (!cache) return read();
  const entries = metadataCaches.get(cache);
  if (!entries) return Promise.reject(new Error('The calendar metadata read scope is invalid.'));
  const key = JSON.stringify(['google-display-metadata', account.id, account.provider, account.subject,
    Boolean(account.consent.calendarRead), Boolean(account.consent.categoryRead), url]);
  const requireCurrentScope = async () => {
    const current = (await getAccounts()).find((item) => item.id === account.id &&
      item.provider === account.provider && item.subject === account.subject);
    if (!current?.consent.calendarRead ||
        Boolean(current.consent.categoryRead) !== Boolean(account.consent.categoryRead)) {
      entries.delete(key);
      throw new Error('Calendar metadata access changed. Refresh the connected account before continuing.');
    }
  };
  // A cache hit must not skip accountFetch's live consent boundary. The caller
  // may be an adapter created before a disconnect or category-consent change.
  await requireCurrentScope();
  let pending = entries.get(key);
  if (!pending) {
    // A bounded pass-local snapshot also coalesces overlapping readers. Errors
    // are evicted so a later request can recover instead of inheriting a failure.
    pending = Promise.resolve().then(read).then(detachedMetadata);
    while (entries.size >= MAX_METADATA_READS) entries.delete(entries.keys().next().value!);
    entries.set(key, pending);
    const current = pending;
    void pending.catch(() => { if (entries.get(key) === current) entries.delete(key); });
  }
  // Keep provider objects and callers from mutating another adapter's snapshot.
  const result = await pending;
  await requireCurrentScope();
  return detachedMetadata(result);
}

function descriptionLogMetadata(value: unknown): DescriptionLog | undefined {
  if (value === undefined) return undefined;
  let parsed = value;
  try { if (typeof parsed === 'string') parsed = JSON.parse(parsed); }
  catch { throw new CalendarProviderError('The calendar description metadata needs review.', 409, 'INVALID_DESCRIPTION_METADATA'); }
  if (!isDescriptionLog(parsed)) throw new CalendarProviderError('The calendar description metadata needs review.', 409, 'INVALID_DESCRIPTION_METADATA');
  return parsed;
}

export class CalendarProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfter: string | null = null,
  ) {
    super(message);
    this.name = 'CalendarProviderError';
  }
}

export class CalendarConflictError extends CalendarProviderError {
  constructor(message = 'This calendar event changed elsewhere. Refresh it before choosing which version to keep.') {
    super(message, 412, 'CALENDAR_CONFLICT');
    this.name = 'CalendarConflictError';
  }
}

function encoded(value: string) {
  return encodeURIComponent(value);
}

function query(url: string, values: Record<string, string>) {
  const params = Object.entries(values)
    .map(([key, value]) => `${encoded(key)}=${encoded(value)}`)
    .join('&');
  return `${url}${url.includes('?') ? '&' : '?'}${params}`;
}

function requireRead(account: ConnectedAccount) {
  if (!account.consent.calendarRead) throw new Error('Calendar reading is disabled for this account.');
}

function requireWrite(account: ConnectedAccount) {
  requireRead(account);
  if (!account.consent.calendarWrite) throw new Error('Calendar changes are disabled for this account.');
}

function requireOccurrence(event: RemoteCalendarEvent) {
  if (event.isSeriesMaster) {
    throw new CalendarProviderError(
      'Select one occurrence of the recurring plan. Context does not edit the whole series.',
      400,
      'OCCURRENCE_REQUIRED',
    );
  }
  if (event.allDay) {
    throw new CalendarProviderError('Choose a timed plan for minute-level replacement.', 400, 'TIMED_EVENT_REQUIRED');
  }
}

function requireVersion(event: RemoteCalendarEvent) {
  if (!event.version) {
    throw new CalendarProviderError('The calendar did not supply a version. Refresh before changing this event.', 409, 'VERSION_REQUIRED');
  }
}

function requireActiveEvent(event: RemoteCalendarEvent) {
  if (event.deleted) {
    throw new CalendarProviderError(
      'This calendar event has been deleted. Refresh the calendar before creating a new activity.',
      410, 'EVENT_DELETED',
    );
  }
}

function requireInvitationConsent(account: ConnectedAccount, event: RemoteCalendarEvent) {
  if (event.isInvitation && !account.consent.editInvitations) {
    throw new CalendarProviderError(
      'Enable invitation editing for this account and approve this source before changing its meeting.',
      403, 'INVITATION_PERMISSION_REQUIRED',
    );
  }
  if (event.canEdit === false) {
    throw new CalendarProviderError(
      'This provider does not allow you to edit the source event. Ask its organizer to change it or record a separate actual activity.',
      403, 'SOURCE_NOT_EDITABLE',
    );
  }
}

function requireSeriesConsent(account: ConnectedAccount) {
  requireWrite(account);
  if (!account.consent.editSeries) {
    throw new CalendarProviderError(
      'Enable recurring-series editing and explicitly choose the whole series before applying this change.',
      403, 'SERIES_PERMISSION_REQUIRED',
    );
  }
}

function requireSourceOperation(write: CalendarEventWrite) {
  if (!write.sourceOperationId || !/^[A-Za-z0-9_-]{1,160}$/.test(write.sourceOperationId)) {
    throw new CalendarProviderError('This series change needs a saved operation identifier. Confirm the whole-series change again.', 409, 'SOURCE_OPERATION_REQUIRED');
  }
}

/** Apply selected-occurrence deltas to the series anchor, never today's absolute calendar date. */
export function seriesWriteFromOccurrence(
  master: RemoteCalendarEvent,
  occurrence: RemoteCalendarEvent,
  write: CalendarEventWrite,
): CalendarEventWrite {
  requireWriteRange(write);
  if (!master.isSeriesMaster || occurrence.isSeriesMaster || master.allDay || occurrence.allDay) {
    throw new CalendarProviderError('Choose a timed occurrence and its recurring-series master.', 400, 'SERIES_OCCURRENCE_REQUIRED');
  }
  const startDelta = Date.parse(write.start) - Date.parse(occurrence.start);
  const endDelta = Date.parse(write.end) - Date.parse(occurrence.end);
  const start = new Date(Date.parse(master.start) + startDelta).toISOString();
  const end = new Date(Date.parse(master.end) + endDelta).toISOString();
  if (Date.parse(end) <= Date.parse(start)) {
    throw new CalendarProviderError('The series change would end before it starts.', 400, 'INVALID_SERIES_RANGE');
  }
  return { ...write, start, end, timeZone: master.timeZone || write.timeZone };
}

function requireWriteRange(write: CalendarEventWrite) {
  const start = Date.parse(write.start);
  const end = Date.parse(write.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('The calendar activity must have a valid start and later end.');
  }
  if (!write.projectionId || write.projectionId.length > 200) throw new Error('A stable Context projection identifier is required.');
}

async function expectJson(response: Response): Promise<JsonObject> {
  if (!response.ok) {
    if (response.status === 412) throw new CalendarConflictError();
    let providerCode = `HTTP_${response.status}`;
    try {
      const body = await response.json();
      const code = body?.error?.code;
      if (typeof code === 'string') providerCode = code;
    } catch {
      // Do not expose provider payloads, which can contain private event text or account details.
    }
    const message = response.status === 429
      ? 'Calendar requests are temporarily limited. Context will retry later.'
      : response.status === 401
        ? 'Calendar access needs to be renewed for this account.'
        : response.status === 403
          ? 'The provider did not allow this source change. Check calendar permissions or ask the event organizer.'
        : `The calendar request failed (${response.status}).`;
    throw new CalendarProviderError(message, response.status, providerCode, response.headers.get('Retry-After'));
  }
  return response.status === 204 ? {} : response.json();
}

/** Event descriptions are data only. Strip markup when a provider ignores the text-body preference. */
export function calendarHtmlToText(value: string) {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  };
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a\s*>/gi,
      (_whole, href: string, label: string) => `${label} (${href})`)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity: string) => {
      if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? whole;
      const number = entity[1]?.toLowerCase() === 'x'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isInteger(number) && number >= 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : whole;
    })
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A reversible ASCII-to-hex encoding uses only Google's permitted base32hex alphabet. */
export function googleProjectionEventId(projectionId: string) {
  if (!/^[\x20-\x7e]{1,200}$/.test(projectionId)) throw new Error('Invalid Context projection identifier.');
  return `c017${Array.from(projectionId).map((character) => character.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`;
}

function googleTime(value: JsonObject | undefined, fallback = '1970-01-01T00:00:00.000Z') {
  if (typeof value?.dateTime === 'string') return new Date(value.dateTime).toISOString();
  if (typeof value?.date === 'string') return `${value.date}T00:00:00.000Z`;
  return fallback;
}

/** Keep missing mutation time unknown. A canceled Google resource may contain only its ID. */
function providerTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.exec(value);
  if (!parts) return undefined;
  const date = new Date(`${parts[1]}T00:00:00.000Z`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== parts[1] ||
      !Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toISOString();
}

export function normalizeGoogleEvent(raw: JsonObject, calendarId: string): RemoteCalendarEvent {
  const properties = raw.extendedProperties?.private ?? {};
  const deleted = raw.status === 'cancelled';
  const start = googleTime(raw.start, googleTime(raw.originalStartTime));
  return {
    id: String(raw.id),
    calendarId,
    title: typeof raw.summary === 'string' ? raw.summary : 'Untitled event',
    description: typeof raw.description === 'string' ? raw.description : '',
    descriptionLog: deleted ? undefined : descriptionLogMetadata(properties.contextDescriptionLog),
    start,
    end: googleTime(raw.end, start),
    timeZone: raw.start?.timeZone || 'UTC',
    allDay: Boolean(raw.start?.date),
    version: typeof raw.etag === 'string' ? raw.etag : '',
    createdAt: providerTimestamp(raw.created),
    updatedAt: providerTimestamp(raw.updated),
    seriesId: typeof raw.recurringEventId === 'string' ? raw.recurringEventId : undefined,
    originalStart: raw.originalStartTime ? googleTime(raw.originalStartTime) : undefined,
    isSeriesMaster: Array.isArray(raw.recurrence) && raw.recurrence.length > 0,
    deleted,
    isInvitation: Boolean((raw.attendees?.length ?? 0) > 0 || raw.organizer?.self === false),
    organizer: typeof raw.organizer?.email === 'string' ? raw.organizer.email : undefined,
    selfOrganizer: typeof raw.organizer?.self === 'boolean' ? raw.organizer.self : undefined,
    canEdit: typeof raw.canEdit === 'boolean' ? raw.canEdit : undefined,
    googleColorId: typeof raw.colorId === 'string' ? raw.colorId : undefined,
    displayColor: typeof raw.displayColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.displayColor) ? raw.displayColor : undefined,
    googleEventLabelId: typeof raw.eventLabelId === 'string' ? raw.eventLabelId : undefined,
    sourceOperationId: typeof properties.contextSourceOperationId === 'string' ? properties.contextSourceOperationId : undefined,
    projectionId: typeof properties.contextProjectionId === 'string' ? properties.contextProjectionId : undefined,
    categoryId: typeof properties.contextCategoryId === 'string' ? properties.contextCategoryId : undefined,
  };
}

function googleWrite(write: CalendarEventWrite) {
  requireWriteRange(write);
  return {
    summary: write.title,
    description: write.description,
    start: { dateTime: write.start, timeZone: write.timeZone },
    end: { dateTime: write.end, timeZone: write.timeZone },
    extendedProperties: {
      private: { contextProjectionId: write.projectionId, contextCategoryId: write.categoryId,
        ...(write.descriptionLog ? { contextDescriptionLog: JSON.stringify(write.descriptionLog) } : {}) },
    },
    ...(write.googleEventLabelId ? { eventLabelId: write.googleEventLabelId }
      : write.googleColorId ? { colorId: write.googleColorId } : {}),
  };
}

function googleAdapter(account: ConnectedAccount, metadataReads?: CalendarMetadataReadCache): AccountCalendarAdapter {
  const eventsUrl = (calendarId: string) => `${GOOGLE}/calendars/${encoded(calendarId)}/events`;
  const eventUrl = (calendarId: string, id: string) => `${eventsUrl(calendarId)}/${encoded(id)}`;
  const withDisplayColors = async (events: RemoteCalendarEvent[], calendarId: string) => {
    const needPalette = events.some((event) => !event.deleted && event.googleColorId && !event.googleEventLabelId && !event.displayColor);
    const needLabels = account.consent.categoryRead && events.some((event) => !event.deleted && event.googleEventLabelId && !event.displayColor);
    const [palette, labels] = await Promise.allSettled([
      needPalette ? readGoogleMetadata(account, `${GOOGLE}/colors`, metadataReads) : Promise.resolve(null),
      needLabels ? readGoogleMetadata(account, query(`${GOOGLE}/calendars/${encoded(calendarId)}`, { eventLabelVersion: '1' }), metadataReads) : Promise.resolve(null),
    ]);
    const eventColors = palette.status === 'fulfilled' ? palette.value?.event : undefined;
    const eventLabels = labels.status === 'fulfilled' ? labels.value?.labelProperties?.eventLabels : undefined;
    return events.map((event) => {
      const provided = event.googleEventLabelId
        ? eventLabels?.find((label: JsonObject) => label.id === event.googleEventLabelId)?.backgroundColor
        : eventColors?.[event.googleColorId ?? '']?.background;
      return event.displayColor || typeof provided !== 'string' || !/^#[0-9a-f]{6}$/i.test(provided)
        ? event : { ...event, displayColor: provided };
    });
  };
  const adapter: AccountCalendarAdapter = {
    async listCalendars() {
      requireRead(account);
      const calendars: AccountCalendar[] = [];
      let pageToken: string | undefined;
      do {
        const page = await expectJson(await accountFetch(account, query(`${GOOGLE}/users/me/calendarList`, {
          maxResults: '250', ...(pageToken ? { pageToken } : {}),
        })));
        for (const item of page.items ?? []) {
          if (item.deleted) continue;
          const providedColor = typeof item.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(item.backgroundColor)
            ? item.backgroundColor : undefined;
          calendars.push({
            id: String(item.id), title: String(item.summaryOverride || item.summary || 'Calendar'),
            color: providedColor ?? '#8E8C86', providedColor,
            writable: item.accessRole === 'owner' || item.accessRole === 'writer',
          });
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
      return calendars;
    },
    async listEvents(calendarId, start, end) {
      requireRead(account);
      const events: RemoteCalendarEvent[] = [];
      let pageToken: string | undefined;
      do {
        const page = await expectJson(await accountFetch(account, query(eventsUrl(calendarId), {
          timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString(),
          singleEvents: 'true', showDeleted: 'true', maxResults: '2500', eventLabelVersion: '1',
          ...(pageToken ? { pageToken } : {}),
        })));
        for (const raw of page.items ?? []) events.push(normalizeGoogleEvent(raw, calendarId));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return withDisplayColors(events, calendarId);
    },
    async getEvent(calendarId, id) {
      requireRead(account);
      const response = await accountFetch(account, query(eventUrl(calendarId, id), { eventLabelVersion: '1' }));
      if (response.status === 404 || response.status === 410) return null;
      const event = normalizeGoogleEvent(await expectJson(response), calendarId);
      if (!event.deleted && event.isSeriesMaster) requireOccurrence(event);
      return (await withDisplayColors([event], calendarId))[0]!;
    },
    async findProjectedEvent(calendarId, projectionId) {
      requireRead(account);
      const id = googleProjectionEventId(projectionId);
      const event = await adapter.getEvent(calendarId, id);
      if (!event) return null;
      if (event.id !== id || event.projectionId !== projectionId) {
        throw new CalendarProviderError('The calendar event could not be verified as this Context projection. Refresh and review its calendar link.',
          409, 'PROJECTION_IDENTITY_MISMATCH');
      }
      return event;
    },
    async createEvent(calendarId, write) {
      requireWrite(account);
      const id = googleProjectionEventId(write.projectionId);
      const existing = await adapter.getEvent(calendarId, id);
      if (existing) {
        if (existing.projectionId !== write.projectionId || existing.deleted) throw new CalendarConflictError();
        return existing;
      }
      const response = await accountFetch(account, query(eventsUrl(calendarId), {
        sendUpdates: 'none', ...(write.googleEventLabelId ? { eventLabelVersion: '1' } : {}),
      }), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...googleWrite(write) }),
      });
      if (response.status === 409) {
        const recovered = await adapter.getEvent(calendarId, id);
        if (recovered && !recovered.deleted && recovered.projectionId === write.projectionId) return recovered;
        throw new CalendarConflictError();
      }
      return (await withDisplayColors([normalizeGoogleEvent(await expectJson(response), calendarId)], calendarId))[0]!;
    },
    async updateEvent(event, write) {
      requireWrite(account);
      requireActiveEvent(event);
      requireOccurrence(event);
      requireVersion(event);
      requireInvitationConsent(account, event);
      if (!event.projectionId && !account.consent.replaceOccurrences) {
        throw new Error('Replacing original plans is disabled for this account.');
      }
      const response = await accountFetch(account, query(eventUrl(event.calendarId, event.id), {
        sendUpdates: event.isInvitation ? 'all' : 'none',
        ...(write.googleEventLabelId ? { eventLabelVersion: '1' } : {}),
      }), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'If-Match': event.version },
        body: JSON.stringify(googleWrite(write)),
      });
      return (await withDisplayColors([normalizeGoogleEvent(await expectJson(response), event.calendarId)], event.calendarId))[0]!;
    },
    async deleteEvent(event) {
      requireWrite(account);
      if (event.deleted) return;
      requireOccurrence(event);
      requireVersion(event);
      requireInvitationConsent(account, event);
      if (!event.projectionId && !account.consent.replaceOccurrences) throw new Error('Original plan changes are disabled.');
      const response = await accountFetch(account, query(eventUrl(event.calendarId, event.id), { sendUpdates: event.isInvitation ? 'all' : 'none' }), {
        method: 'DELETE', headers: { 'If-Match': event.version },
      });
      if (response.status !== 404 && response.status !== 410) await expectJson(response);
    },
    async getSeries(event) {
      requireRead(account);
      if (!event.seriesId) return null;
      const response = await accountFetch(account, query(eventUrl(event.calendarId, event.seriesId), { eventLabelVersion: '1' }));
      if (response.status === 404 || response.status === 410) return null;
      const master = normalizeGoogleEvent(await expectJson(response), event.calendarId);
      if (master.deleted) return null;
      if (!master.isSeriesMaster) throw new CalendarConflictError('The original recurring series is no longer available.');
      return master;
    },
    async updateSeries(event, write) {
      requireSeriesConsent(account);
      requireSourceOperation(write);
      requireActiveEvent(event);
      requireOccurrence(event);
      requireInvitationConsent(account, event);
      const master = await adapter.getSeries(event);
      if (!master) throw new CalendarProviderError('The source series could not be found. Refresh its occurrence before retrying.', 404, 'SERIES_NOT_FOUND');
      requireVersion(master);
      requireInvitationConsent(account, master);
      if (write.sourceOperationId && master.sourceOperationId === write.sourceOperationId) return master;
      const occurrence = await adapter.getEvent(event.calendarId, event.id);
      if (!occurrence || occurrence.version !== event.version) throw new CalendarConflictError();
      requireInvitationConsent(account, occurrence);
      const shifted = seriesWriteFromOccurrence(master, occurrence, write);
      const payload = googleWrite(shifted);
      // Never attach a single actual's identity/log to every occurrence. Whole-series planning
      // changes preserve the master's notes and recurrence rule; the selected actual is separate.
      const { extendedProperties: _metadata, ...body } = payload;
      const response = await accountFetch(account, query(eventUrl(master.calendarId, master.id), {
        sendUpdates: master.isInvitation || event.isInvitation ? 'all' : 'none',
        ...(write.googleEventLabelId ? { eventLabelVersion: '1' } : {}),
      }), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': master.version },
        body: JSON.stringify({ ...body, description: master.description,
          ...(write.sourceOperationId ? {
            extendedProperties: { private: { contextSourceOperationId: write.sourceOperationId } },
          } : {}),
        }),
      });
      return normalizeGoogleEvent(await expectJson(response), master.calendarId);
    },
  };
  return adapter;
}

function graphInstant(value: JsonObject | undefined, fallback = '1970-01-01T00:00:00.000Z') {
  if (typeof value?.dateTime !== 'string') return fallback;
  const time = value.dateTime.replace(/(\.\d{3})\d+/, '$1');
  // Every request explicitly asks for UTC, so zone-less Graph strings are UTC, never phone-local.
  return new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(time) ? time : `${time}Z`).toISOString();
}

function graphMetadata(raw: JsonObject): { projectionId?: string; categoryId?: string; descriptionLog?: DescriptionLog } {
  const property = (raw.singleValueExtendedProperties ?? []).find(
    (item: JsonObject) => item.id === META_PROPERTY,
  );
  if (!property) return {};
  let metadata: JsonObject;
  try { metadata = JSON.parse(property.value); }
  catch { throw new CalendarProviderError('The calendar description metadata needs review.', 409, 'INVALID_DESCRIPTION_METADATA'); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new CalendarProviderError('The calendar description metadata needs review.', 409, 'INVALID_DESCRIPTION_METADATA');
  }
  return {
    projectionId: typeof metadata.projectionId === 'string' ? metadata.projectionId : undefined,
    categoryId: typeof metadata.categoryId === 'string' ? metadata.categoryId : undefined,
    descriptionLog: descriptionLogMetadata(metadata.descriptionLog),
  };
}

function contextHtmlParts(html: string) {
  const start = html.indexOf(HTML_LOG_START);
  const end = html.indexOf(HTML_LOG_END, start);
  if (start < 0 || end < start || html.indexOf(HTML_LOG_START, start + HTML_LOG_START.length) >= 0 ||
      html.indexOf(HTML_LOG_END, end + HTML_LOG_END.length) >= 0) return null;
  const section = html.slice(start + HTML_LOG_START.length, end);
  const opening = '<pre style="white-space:pre-wrap">';
  if (!section.startsWith(opening) || !section.endsWith('</pre>')) return null;
  const encodedLog = section.slice(opening.length, -'</pre>'.length);
  if (/[<>]/.test(encodedLog)) return null;
  const names: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const log = encodedLog.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity: string) => {
    if (!entity.startsWith('#')) return names[entity.toLowerCase()] ?? whole;
    const code = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
  return { preservedHtml: html.slice(0, start) + html.slice(end + HTML_LOG_END.length), log };
}

export function normalizeMicrosoftEvent(raw: JsonObject, calendarId: string): RemoteCalendarEvent {
  const deleted = Boolean(raw.isCancelled || raw['@removed']);
  const metadata = deleted ? {} : graphMetadata(raw);
  const description = typeof raw.body?.content === 'string' ? raw.body.content : '';
  const isHtml = raw.body?.contentType?.toLowerCase() === 'html';
  const isOnlineMeeting = Boolean(raw.isOnlineMeeting || raw.onlineMeeting || raw.onlineMeetingUrl);
  let plainDescription = isHtml ? calendarHtmlToText(description) : description;
  if (isHtml && metadata.descriptionLog && metadata.projectionId) {
    const parts = contextHtmlParts(description);
    if (!parts) throw new CalendarProviderError('This calendar description needs review before synchronization.', 409, 'INVALID_CONTEXT_HTML_SECTION');
    const preserved = calendarHtmlToText(parts.preservedHtml);
    plainDescription = preserved ? `${preserved}\n\n${parts.log}` : parts.log;
  }
  const start = graphInstant(raw.start);
  return {
    id: String(raw.id), calendarId,
    title: typeof raw.subject === 'string' ? raw.subject : 'Untitled event',
    description: plainDescription,
    start, end: graphInstant(raw.end, start),
    timeZone: raw.originalStartTimeZone || raw.start?.timeZone || 'UTC',
    allDay: Boolean(raw.isAllDay),
    version: typeof raw['@odata.etag'] === 'string' ? raw['@odata.etag'] : '',
    createdAt: providerTimestamp(raw.createdDateTime),
    updatedAt: providerTimestamp(raw.lastModifiedDateTime),
    seriesId: typeof raw.seriesMasterId === 'string' ? raw.seriesMasterId : undefined,
    originalStart: typeof raw.originalStart === 'string' ? new Date(raw.originalStart).toISOString() : undefined,
    isSeriesMaster: raw.type === 'seriesMaster',
    deleted,
    isOnlineMeeting,
    bodyHtml: isHtml ? description : undefined,
    isInvitation: Boolean(isOnlineMeeting || (raw.attendees?.length ?? 0) > 0 || raw.isOrganizer === false),
    organizer: typeof raw.organizer?.emailAddress?.address === 'string' ? raw.organizer.emailAddress.address : undefined,
    selfOrganizer: typeof raw.isOrganizer === 'boolean' ? raw.isOrganizer : undefined,
    canEdit: typeof raw.canEdit === 'boolean' ? raw.canEdit : undefined,
    microsoftCategories: Array.isArray(raw.categories)
      ? raw.categories.filter((item: unknown): item is string => typeof item === 'string') : undefined,
    displayColor: typeof raw.displayColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.displayColor) ? raw.displayColor : undefined,
    sourceOperationId: (raw.singleValueExtendedProperties ?? []).find(
      (item: JsonObject) => item.id === SOURCE_OPERATION_PROPERTY,
    )?.value,
    ...metadata,
  };
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** Preserve every byte outside our own bounded HTML section, including the Teams meeting blob. */
export function meetingBodyWithContext(rawHtml: string | undefined, description: string, descriptionLog?: DescriptionLog, projectionId?: string,
  previous?: Pick<RemoteCalendarEvent, 'description' | 'descriptionLog' | 'projectionId'>) {
  if (!rawHtml) {
    throw new CalendarProviderError(
      'The online meeting’s original HTML body is unavailable. Refresh the event before updating it in Context.',
      409, 'MEETING_BODY_REQUIRED',
    );
  }
  const ownership = projectionId ?? 'context-html-legacy';
  const log = readCalendarDescription({ description, descriptionLog, projectionId: ownership }, ownership).log;
  if (log == null) {
    throw new CalendarProviderError(
      'The online meeting update needs a complete Context minute section. Refresh the linked activity and retry.',
      409, 'CONTEXT_SECTION_REQUIRED',
    );
  }
  let preserved = rawHtml;
  if (preserved.includes(HTML_LOG_START) || preserved.includes(HTML_LOG_END)) {
    const existing = contextHtmlParts(preserved);
    if (!existing) throw new CalendarProviderError('The online meeting contains an ambiguous Context section. Review it before updating.',
      409, 'INVALID_CONTEXT_HTML_SECTION');
    let owned = false;
    if (previous?.projectionId === ownership) {
      const prior = readCalendarDescription(previous, ownership);
      owned = prior.format === 'clean' ? prior.log === existing.log : prior.format === 'legacy';
    }
    if (!owned) {
      // A previous legacy section is ours only when its exact projection footer proves it.
      owned = readCalendarDescription({ description: existing.log }, ownership).format === 'legacy';
    }
    if (!owned) throw new CalendarProviderError('This meeting contains notes in a reserved section. Review them before updating.',
      409, 'UNPROVEN_CONTEXT_HTML_SECTION');
    preserved = existing.preservedHtml;
  }
  const section = `${HTML_LOG_START}<pre style="white-space:pre-wrap">${escapeHtml(log)}</pre>${HTML_LOG_END}`;
  const closingBody = preserved.toLowerCase().lastIndexOf('</body>');
  const closingHtml = preserved.toLowerCase().lastIndexOf('</html>');
  const insertion = closingBody >= 0 ? closingBody : closingHtml >= 0 ? closingHtml : preserved.length;
  return preserved.slice(0, insertion) + section + preserved.slice(insertion);
}

function graphWrite(write: CalendarEventWrite) {
  requireWriteRange(write);
  return {
    subject: write.title,
    body: { contentType: 'text', content: write.description },
    start: { dateTime: new Date(write.start).toISOString().replace(/Z$/, ''), timeZone: 'UTC' },
    end: { dateTime: new Date(write.end).toISOString().replace(/Z$/, ''), timeZone: 'UTC' },
    singleValueExtendedProperties: [{
      id: META_PROPERTY,
      value: JSON.stringify({ projectionId: write.projectionId, categoryId: write.categoryId,
        ...(write.descriptionLog ? { descriptionLog: write.descriptionLog } : {}) }),
    }],
    ...(write.microsoftCategories ? { categories: write.microsoftCategories } : {}),
  };
}

function graphWrittenEvent(raw: JsonObject, calendarId: string, write: CalendarEventWrite) {
  return normalizeMicrosoftEvent({ ...raw, singleValueExtendedProperties: [
    ...(raw.singleValueExtendedProperties ?? []).filter((item: JsonObject) => item.id !== META_PROPERTY),
    { id: META_PROPERTY, value: JSON.stringify({ projectionId: write.projectionId, categoryId: write.categoryId,
      ...(write.descriptionLog ? { descriptionLog: write.descriptionLog } : {}) }) },
  ] }, calendarId);
}

function microsoftAdapter(account: ConnectedAccount): AccountCalendarAdapter {
  const eventsUrl = (calendarId: string) => `${GRAPH}/me/calendars/${encoded(calendarId)}/events`;
  const eventUrl = (calendarId: string, id: string) => `${eventsUrl(calendarId)}/${encoded(id)}`;
  async function request(url: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('Prefer', GRAPH_PREFER);
    return accountFetch(account, url, { ...init, headers });
  }
  async function collect(url: string, confirmCollection = false) {
    const items: JsonObject[] = [];
    const seen = new Set<string>();
    let next: string | undefined = url;
    while (next) {
      if (seen.has(next)) throw new Error('Microsoft returned a repeated calendar page.');
      seen.add(next);
      const page = await expectJson(await request(next));
      if (confirmCollection && !Array.isArray(page.value)) {
        throw new CalendarProviderError('Microsoft did not confirm the calendar projection search. Try synchronizing again.', 502, 'INVALID_PROVIDER_RESPONSE');
      }
      items.push(...(page.value ?? []));
      next = page['@odata.nextLink'];
    }
    return items;
  }
  async function findProjection(calendarId: string, projectionId: string) {
    requireRead(account);
    if (!/^[\x20-\x7e]{1,200}$/.test(projectionId)) throw new Error('Invalid Context projection identifier.');
    const needle = JSON.stringify({ projectionId }).slice(0, -1).replaceAll("'", "''");
    const existing = await collect(query(eventsUrl(calendarId), {
      '$filter': `singleValueExtendedProperties/Any(ep:ep/id eq '${META_PROPERTY}' and contains(ep/value,'${needle}'))`,
      '$expand': META_EXPAND,
    }), true);
    const matching: RemoteCalendarEvent[] = [];
    for (const item of existing) {
      const event = normalizeMicrosoftEvent(item, calendarId);
      if (event.deleted) continue;
      if (!Array.isArray(item.singleValueExtendedProperties) || !item.singleValueExtendedProperties.some((property: JsonObject) => property.id === META_PROPERTY)) {
        throw new CalendarProviderError('Microsoft did not return the private projection identity. Try synchronizing again.', 409, 'PROJECTION_IDENTITY_MISMATCH');
      }
      if (event.projectionId !== projectionId) continue;
      if (typeof item.id !== 'string' || !item.id) {
        throw new CalendarProviderError('Microsoft did not return the calendar event identity. Try synchronizing again.', 502, 'INVALID_PROVIDER_RESPONSE');
      }
      matching.push(event);
    }
    if (matching.length > 1) throw new CalendarConflictError('More than one calendar event has this Context projection. Review the duplicate events before continuing.');
    const event = matching[0] ?? null;
    if (event) requireOccurrence(event);
    return event;
  }
  const adapter: AccountCalendarAdapter = {
    async listCalendars() {
      requireRead(account);
      const items = await collect(query(`${GRAPH}/me/calendars`, {
        '$select': 'id,name,hexColor,canEdit', '$top': '100',
      }));
      return items.map((item) => ({
        id: String(item.id), title: String(item.name || 'Calendar'),
        color: item.hexColor || '#8E8C86',
        providedColor: typeof item.hexColor === 'string' && /^#[0-9a-f]{6}$/i.test(item.hexColor) ? item.hexColor : undefined,
        writable: Boolean(item.canEdit),
      }));
    },
    async listEvents(calendarId, start, end) {
      requireRead(account);
      const items = await collect(query(`${GRAPH}/me/calendars/${encoded(calendarId)}/calendarView`, {
        startDateTime: new Date(start).toISOString(), endDateTime: new Date(end).toISOString(),
        '$top': '1000', '$expand': META_EXPAND,
      }));
      return items.map((item) => normalizeMicrosoftEvent(item, calendarId));
    },
    async getEvent(calendarId, id) {
      requireRead(account);
      const response = await request(query(eventUrl(calendarId, id), { '$expand': META_EXPAND }));
      if (response.status === 404 || response.status === 410) return null;
      const event = normalizeMicrosoftEvent(await expectJson(response), calendarId);
      if (!event.deleted && event.isSeriesMaster) requireOccurrence(event);
      return event;
    },
    findProjectedEvent: findProjection,
    async createEvent(calendarId, write) {
      requireWrite(account);
      requireWriteRange(write);
      // Persisted projection IDs remain identical across phones and across transport retries.
      const recovered = await findProjection(calendarId, write.projectionId);
      if (recovered) return recovered;
      const response = await request(eventsUrl(calendarId), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: write.projectionId, ...graphWrite(write) }),
      });
      const created = graphWrittenEvent(await expectJson(response), calendarId, write);
      // Some Graph deployments omit expanded properties on write responses.
      return { ...created, projectionId: write.projectionId, categoryId: write.categoryId };
    },
    async updateEvent(event, write) {
      requireWrite(account);
      requireActiveEvent(event);
      requireOccurrence(event);
      requireVersion(event);
      requireInvitationConsent(account, event);
      if (!event.projectionId && !account.consent.replaceOccurrences) throw new Error('Replacing original plans is disabled for this account.');
      // Also preflight the current server type/version. If-Match closes the subsequent race.
      const current = await adapter.getEvent(event.calendarId, event.id);
      if (!current || current.version !== event.version) throw new CalendarConflictError();
      requireActiveEvent(current);
      requireInvitationConsent(account, current);
      const payload = graphWrite(write);
      if (current.isOnlineMeeting || event.isOnlineMeeting) {
        payload.body = {
          contentType: 'html', content: meetingBodyWithContext(current.bodyHtml, write.description, write.descriptionLog, write.projectionId, current),
        };
      }
      const response = await request(eventUrl(event.calendarId, event.id), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': event.version },
        body: JSON.stringify(payload),
      });
      const updated = graphWrittenEvent(await expectJson(response), event.calendarId, write);
      return { ...updated, projectionId: write.projectionId, categoryId: write.categoryId };
    },
    async deleteEvent(event) {
      requireWrite(account);
      if (event.deleted) return;
      requireOccurrence(event);
      requireVersion(event);
      requireInvitationConsent(account, event);
      if (!event.projectionId && !account.consent.replaceOccurrences) throw new Error('Original plan changes are disabled.');
      const current = await adapter.getEvent(event.calendarId, event.id);
      if (!current || current.deleted) return;
      if (current.version !== event.version) throw new CalendarConflictError();
      requireInvitationConsent(account, current);
      const response = await request(eventUrl(event.calendarId, event.id), {
        method: 'DELETE', headers: { 'If-Match': event.version },
      });
      if (response.status !== 404 && response.status !== 410) await expectJson(response);
    },
    async getSeries(event) {
      requireRead(account);
      if (!event.seriesId) return null;
      const response = await request(query(eventUrl(event.calendarId, event.seriesId), {
        '$expand': `singleValueExtendedProperties($filter=id eq '${SOURCE_OPERATION_PROPERTY}')`,
      }));
      if (response.status === 404 || response.status === 410) return null;
      const master = normalizeMicrosoftEvent(await expectJson(response), event.calendarId);
      if (master.deleted) return null;
      if (!master.isSeriesMaster) throw new CalendarConflictError('The original recurring series is no longer available.');
      return master;
    },
    async updateSeries(event, write) {
      requireSeriesConsent(account);
      requireSourceOperation(write);
      requireActiveEvent(event);
      requireOccurrence(event);
      requireInvitationConsent(account, event);
      const master = await adapter.getSeries(event);
      if (!master) throw new CalendarProviderError('The source series could not be found. Refresh its occurrence before retrying.', 404, 'SERIES_NOT_FOUND');
      requireVersion(master);
      requireInvitationConsent(account, master);
      if (write.sourceOperationId && master.sourceOperationId === write.sourceOperationId) return master;
      const occurrence = await adapter.getEvent(event.calendarId, event.id);
      if (!occurrence || occurrence.version !== event.version) throw new CalendarConflictError();
      requireInvitationConsent(account, occurrence);
      const shifted = seriesWriteFromOccurrence(master, occurrence, write);
      // Keep the master's body untouched, especially its online-meeting blob, and do not set a
      // single occurrence's Context metadata or recurrence rule on the entire series.
      const payload = graphWrite(shifted);
      const { body: _body, singleValueExtendedProperties: _metadata, ...seriesBody } = payload;
      const response = await request(eventUrl(master.calendarId, master.id), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': master.version },
        body: JSON.stringify({ ...seriesBody,
          ...(write.sourceOperationId ? { singleValueExtendedProperties: [{
            id: SOURCE_OPERATION_PROPERTY, value: write.sourceOperationId,
          }] } : {}),
        }),
      });
      return normalizeMicrosoftEvent(await expectJson(response), master.calendarId);
    },
  };
  return adapter;
}

export function createCalendarAdapter(account: ConnectedAccount, metadataReads?: CalendarMetadataReadCache): AccountCalendarAdapter {
  if (account.provider === 'google') return googleAdapter(account, metadataReads);
  if (account.provider === 'microsoft') return microsoftAdapter(account);
  throw new Error('This account supports encrypted ledger storage only. Connect Google or Microsoft for calendar access.');
}
