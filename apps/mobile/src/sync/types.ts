export type AccountProvider = 'google' | 'microsoft' | 'webdav';

export type AccountConsent = {
  ledgerStorage: boolean;
  calendarRead: boolean;
  calendarWrite: boolean;
  replaceOccurrences: boolean;
  importCalendarEdits: boolean;
  editInvitations?: boolean;
  editSeries?: boolean;
  categoryRead?: boolean;
};

export type ConnectedAccount = {
  id: string;
  provider: AccountProvider;
  subject: string;
  label: string;
  consent: AccountConsent;
  storageUrl?: string;
  storageUser?: string;
};

export type SyncDocument = {
  key: string;
  revision: string;
  value: Record<string, unknown> | null;
};

export type SyncBatch = {
  version: 1;
  id: string;
  documents: SyncDocument[];
};

export type StorageFile = { id: string; name: string };

export interface LedgerStorage {
  listFiles(): Promise<StorageFile[]>;
  readFile(file: StorageFile): Promise<string>;
  writeFile(name: string, contents: string): Promise<void>;
}

export type AccountCalendar = {
  id: string;
  title: string;
  color: string;
  /** Exact validated provider value; color can instead be a UI fallback. */
  providedColor?: string;
  writable: boolean;
};

export type RemoteCalendarEvent = {
  id: string;
  calendarId: string;
  title: string;
  description: string;
  /** Ownership of a generated suffix, stored in provider-private metadata. */
  descriptionLog?: import('../utils/calendar-description').DescriptionLog;
  start: string;
  end: string;
  timeZone: string;
  allDay: boolean;
  version: string;
  seriesId?: string;
  originalStart?: string;
  isSeriesMaster: boolean;
  deleted: boolean;
  projectionId?: string;
  categoryId?: string;
  isOnlineMeeting?: boolean;
  bodyHtml?: string;
  isInvitation?: boolean;
  organizer?: string;
  selfOrganizer?: boolean;
  canEdit?: boolean;
  googleColorId?: string;
  /** Exact read-only event/label background supplied by the provider. */
  displayColor?: string;
  googleEventLabelId?: string;
  microsoftCategories?: string[];
  sourceOperationId?: string;
};

export type CalendarEventWrite = {
  title: string;
  description: string;
  descriptionLog?: import('../utils/calendar-description').DescriptionLog;
  start: string;
  end: string;
  timeZone: string;
  projectionId: string;
  categoryId: string;
  googleColorId?: string;
  googleEventLabelId?: string;
  microsoftCategories?: string[];
  sourceOperationId?: string;
};

export interface AccountCalendarAdapter {
  listCalendars(): Promise<AccountCalendar[]>;
  listEvents(calendarId: string, start: string, end: string): Promise<RemoteCalendarEvent[]>;
  getEvent(calendarId: string, eventId: string): Promise<RemoteCalendarEvent | null>;
  createEvent(calendarId: string, write: CalendarEventWrite): Promise<RemoteCalendarEvent>;
  updateEvent(event: RemoteCalendarEvent, write: CalendarEventWrite): Promise<RemoteCalendarEvent>;
  deleteEvent(event: RemoteCalendarEvent): Promise<void>;
  getSeries(event: RemoteCalendarEvent): Promise<RemoteCalendarEvent | null>;
  updateSeries(event: RemoteCalendarEvent, write: CalendarEventWrite): Promise<RemoteCalendarEvent>;
}

export type Projection = {
  id: string;
  accountId: string;
  calendarId: string;
  eventId: string | null;
  sourceEventId: string | null;
  sourceSeriesId?: string;
  originalStart?: string;
  blockId: string;
  dateKey: string;
  endDateKey?: string;
  startMinute: number;
  endMinute: number;
  title?: string;
  timeZone?: string;
  anchorStart?: string;
  anchorDate?: string;
  anchorMinute?: number;
  baseEvent: RemoteCalendarEvent | null;
  baseLocalHash: string | null;
  state: 'pending' | 'synced' | 'conflict' | 'deleted';
  conflict?: string;
  pendingSourceScope?: 'occurrence' | 'series';
  pendingSourceOperationId?: string;
};

export type AccountSyncStatus = {
  running: boolean;
  lastSyncedAt: string | null;
  message: string;
  conflicts: number;
};
