import { accountFetch } from './accounts';
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

export function normalizeGoogleEvent(raw: JsonObject, calendarId: string): RemoteCalendarEvent {
  const properties = raw.extendedProperties?.private ?? {};
  const start = googleTime(raw.start, googleTime(raw.originalStartTime));
  return {
    id: String(raw.id),
    calendarId,
    title: typeof raw.summary === 'string' ? raw.summary : 'Untitled event',
    description: typeof raw.description === 'string' ? raw.description : '',
    start,
    end: googleTime(raw.end, start),
    timeZone: raw.start?.timeZone || 'UTC',
    allDay: Boolean(raw.start?.date),
    version: typeof raw.etag === 'string' ? raw.etag : '',
    seriesId: typeof raw.recurringEventId === 'string' ? raw.recurringEventId : undefined,
    originalStart: raw.originalStartTime ? googleTime(raw.originalStartTime) : undefined,
    isSeriesMaster: Array.isArray(raw.recurrence) && raw.recurrence.length > 0,
    deleted: raw.status === 'cancelled',
    isInvitation: Boolean((raw.attendees?.length ?? 0) > 0 || raw.organizer?.self === false),
    organizer: typeof raw.organizer?.email === 'string' ? raw.organizer.email : undefined,
    selfOrganizer: typeof raw.organizer?.self === 'boolean' ? raw.organizer.self : undefined,
    canEdit: typeof raw.canEdit === 'boolean' ? raw.canEdit : undefined,
    googleColorId: typeof raw.colorId === 'string' ? raw.colorId : undefined,
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
      private: { contextProjectionId: write.projectionId, contextCategoryId: write.categoryId },
    },
    ...(write.googleEventLabelId ? { eventLabelId: write.googleEventLabelId }
      : write.googleColorId ? { colorId: write.googleColorId } : {}),
  };
}

function googleAdapter(account: ConnectedAccount): AccountCalendarAdapter {
  const eventsUrl = (calendarId: string) => `${GOOGLE}/calendars/${encoded(calendarId)}/events`;
  const eventUrl = (calendarId: string, id: string) => `${eventsUrl(calendarId)}/${encoded(id)}`;
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
      return events;
    },
    async getEvent(calendarId, id) {
      requireRead(account);
      const response = await accountFetch(account, query(eventUrl(calendarId, id), { eventLabelVersion: '1' }));
      if (response.status === 404 || response.status === 410) return null;
      const event = normalizeGoogleEvent(await expectJson(response), calendarId);
      if (event.isSeriesMaster) requireOccurrence(event);
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
      return normalizeGoogleEvent(await expectJson(response), calendarId);
    },
    async updateEvent(event, write) {
      requireWrite(account);
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
      return normalizeGoogleEvent(await expectJson(response), event.calendarId);
    },
    async deleteEvent(event) {
      requireWrite(account);
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
      if (!master.isSeriesMaster) throw new CalendarConflictError('The original recurring series is no longer available.');
      return master;
    },
    async updateSeries(event, write) {
      requireSeriesConsent(account);
      requireSourceOperation(write);
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

function graphMetadata(raw: JsonObject): { projectionId?: string; categoryId?: string } {
  const property = (raw.singleValueExtendedProperties ?? []).find(
    (item: JsonObject) => item.id === META_PROPERTY,
  );
  try {
    const metadata = JSON.parse(property?.value ?? '{}');
    return {
      projectionId: typeof metadata.projectionId === 'string' ? metadata.projectionId : undefined,
      categoryId: typeof metadata.categoryId === 'string' ? metadata.categoryId : undefined,
    };
  } catch {
    return {};
  }
}

export function normalizeMicrosoftEvent(raw: JsonObject, calendarId: string): RemoteCalendarEvent {
  const metadata = graphMetadata(raw);
  const description = typeof raw.body?.content === 'string' ? raw.body.content : '';
  const isHtml = raw.body?.contentType?.toLowerCase() === 'html';
  const isOnlineMeeting = Boolean(raw.isOnlineMeeting || raw.onlineMeeting || raw.onlineMeetingUrl);
  const start = graphInstant(raw.start);
  return {
    id: String(raw.id), calendarId,
    title: typeof raw.subject === 'string' ? raw.subject : 'Untitled event',
    description: isHtml ? calendarHtmlToText(description) : description,
    start, end: graphInstant(raw.end, start),
    timeZone: raw.originalStartTimeZone || raw.start?.timeZone || 'UTC',
    allDay: Boolean(raw.isAllDay),
    version: typeof raw['@odata.etag'] === 'string' ? raw['@odata.etag'] : '',
    seriesId: typeof raw.seriesMasterId === 'string' ? raw.seriesMasterId : undefined,
    originalStart: typeof raw.originalStart === 'string' ? new Date(raw.originalStart).toISOString() : undefined,
    isSeriesMaster: raw.type === 'seriesMaster',
    deleted: Boolean(raw.isCancelled || raw['@removed']),
    isOnlineMeeting,
    bodyHtml: isHtml ? description : undefined,
    isInvitation: Boolean(isOnlineMeeting || (raw.attendees?.length ?? 0) > 0 || raw.isOrganizer === false),
    organizer: typeof raw.organizer?.emailAddress?.address === 'string' ? raw.organizer.emailAddress.address : undefined,
    selfOrganizer: typeof raw.isOrganizer === 'boolean' ? raw.isOrganizer : undefined,
    canEdit: typeof raw.canEdit === 'boolean' ? raw.canEdit : undefined,
    microsoftCategories: Array.isArray(raw.categories)
      ? raw.categories.filter((item: unknown): item is string => typeof item === 'string') : undefined,
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
export function meetingBodyWithContext(rawHtml: string | undefined, description: string) {
  if (!rawHtml) {
    throw new CalendarProviderError(
      'The online meeting’s original HTML body is unavailable. Refresh the event before updating it in Context.',
      409, 'MEETING_BODY_REQUIRED',
    );
  }
  const start = description.indexOf('--- Context minutes ---');
  const end = description.indexOf('--- End Context minutes ---', start);
  if (start < 0 || end < start) {
    throw new CalendarProviderError(
      'The online meeting update needs a complete Context minute section. Refresh the linked activity and retry.',
      409, 'CONTEXT_SECTION_REQUIRED',
    );
  }
  const log = description.slice(start, end + '--- End Context minutes ---'.length);
  let preserved = rawHtml;
  while (preserved.includes(HTML_LOG_START)) {
    const sectionStart = preserved.indexOf(HTML_LOG_START);
    const sectionEnd = preserved.indexOf(HTML_LOG_END, sectionStart);
    if (sectionEnd < 0) {
      throw new CalendarProviderError(
        'This online meeting has an incomplete Context section. Repair that section in the calendar before retrying.',
        409, 'INVALID_CONTEXT_HTML_SECTION',
      );
    }
    preserved = preserved.slice(0, sectionStart) + preserved.slice(sectionEnd + HTML_LOG_END.length);
  }
  if (preserved.includes(HTML_LOG_END)) {
    throw new CalendarProviderError('The online meeting contains an incomplete Context section.', 409, 'INVALID_CONTEXT_HTML_SECTION');
  }
  const section = `${HTML_LOG_START}<pre style="white-space:pre-wrap">\n\n${escapeHtml(log)}\n</pre>${HTML_LOG_END}`;
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
      value: JSON.stringify({ projectionId: write.projectionId, categoryId: write.categoryId }),
    }],
    ...(write.microsoftCategories ? { categories: write.microsoftCategories } : {}),
  };
}

function microsoftAdapter(account: ConnectedAccount): AccountCalendarAdapter {
  const eventsUrl = (calendarId: string) => `${GRAPH}/me/calendars/${encoded(calendarId)}/events`;
  const eventUrl = (calendarId: string, id: string) => `${eventsUrl(calendarId)}/${encoded(id)}`;
  async function request(url: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('Prefer', GRAPH_PREFER);
    return accountFetch(account, url, { ...init, headers });
  }
  async function collect(url: string) {
    const items: JsonObject[] = [];
    const seen = new Set<string>();
    let next: string | undefined = url;
    while (next) {
      if (seen.has(next)) throw new Error('Microsoft returned a repeated calendar page.');
      seen.add(next);
      const page = await expectJson(await request(next));
      items.push(...(page.value ?? []));
      next = page['@odata.nextLink'];
    }
    return items;
  }
  const adapter: AccountCalendarAdapter = {
    async listCalendars() {
      requireRead(account);
      const items = await collect(query(`${GRAPH}/me/calendars`, {
        '$select': 'id,name,hexColor,canEdit', '$top': '100',
      }));
      return items.map((item) => ({
        id: String(item.id), title: String(item.name || 'Calendar'),
        color: item.hexColor || '#8E8C86', writable: Boolean(item.canEdit),
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
      if (event.isSeriesMaster) requireOccurrence(event);
      return event;
    },
    async createEvent(calendarId, write) {
      requireWrite(account);
      requireWriteRange(write);
      // Persisted projection IDs remain identical across phones and across transport retries.
      const needle = JSON.stringify({ projectionId: write.projectionId }).slice(0, -1).replaceAll("'", "''");
      const existing = await collect(query(eventsUrl(calendarId), {
        '$filter': `singleValueExtendedProperties/Any(ep:ep/id eq '${META_PROPERTY}' and contains(ep/value,'${needle}'))`,
        '$expand': META_EXPAND,
      }));
      const recovered = existing
        .map((item) => normalizeMicrosoftEvent(item, calendarId))
        .find((item) => !item.deleted && item.projectionId === write.projectionId);
      if (recovered) return recovered;
      const response = await request(eventsUrl(calendarId), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: write.projectionId, ...graphWrite(write) }),
      });
      const created = normalizeMicrosoftEvent(await expectJson(response), calendarId);
      // Some Graph deployments omit expanded properties on write responses.
      return { ...created, projectionId: write.projectionId, categoryId: write.categoryId };
    },
    async updateEvent(event, write) {
      requireWrite(account);
      requireOccurrence(event);
      requireVersion(event);
      requireInvitationConsent(account, event);
      if (!event.projectionId && !account.consent.replaceOccurrences) throw new Error('Replacing original plans is disabled for this account.');
      // Also preflight the current server type/version. If-Match closes the subsequent race.
      const current = await adapter.getEvent(event.calendarId, event.id);
      if (!current || current.version !== event.version) throw new CalendarConflictError();
      requireInvitationConsent(account, current);
      const payload = graphWrite(write);
      if (current.isOnlineMeeting || event.isOnlineMeeting) {
        payload.body = {
          contentType: 'html', content: meetingBodyWithContext(current.bodyHtml, write.description),
        };
      }
      const response = await request(eventUrl(event.calendarId, event.id), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': event.version },
        body: JSON.stringify(payload),
      });
      const updated = normalizeMicrosoftEvent(await expectJson(response), event.calendarId);
      return { ...updated, projectionId: write.projectionId, categoryId: write.categoryId };
    },
    async deleteEvent(event) {
      requireWrite(account);
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
      if (!master.isSeriesMaster) throw new CalendarConflictError('The original recurring series is no longer available.');
      return master;
    },
    async updateSeries(event, write) {
      requireSeriesConsent(account);
      requireSourceOperation(write);
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

export function createCalendarAdapter(account: ConnectedAccount): AccountCalendarAdapter {
  if (account.provider === 'google') return googleAdapter(account);
  if (account.provider === 'microsoft') return microsoftAdapter(account);
  throw new Error('This account supports encrypted ledger storage only. Connect Google or Microsoft for calendar access.');
}
