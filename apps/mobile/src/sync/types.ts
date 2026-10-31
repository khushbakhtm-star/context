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
  /** An exact confirmed identity skips downloading the writer's own immutable
   * batch. Older/custom transports may omit it and retain the prior behavior. */
  writeFile(name: string, contents: string): Promise<StorageFile | void>;
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
  /** Provider mutation times, never event scheduling times or local observation time. */
  createdAt?: string;
  updatedAt?: string;
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
  /** Read-only recovery after an event creation response was lost. Null means
   * the provider confirmed no matching live projection in this exact calendar. */
  findProjectedEvent?(calendarId: string, projectionId: string): Promise<RemoteCalendarEvent | null>;
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
  baseColorSelection?: { categoryId: string; color: string };
  state: 'pending' | 'synced' | 'conflict' | 'deleted';
  /** Local observation fence for stale display caches, never a user/provider
   * mutation timestamp and never used to resolve competing calendar edits. */
  retiredAt?: string;
  /** A newer provider event reclaimed this exact derived split. This is
   * separate from Context's user-edit clock and survives deletion retries. */
  retirementAuthority?: { projectionId: string; eventId: string; version: string; updatedAt: string };
  /** The exact last attempted create, retained until its server identity is
   * acknowledged so a lost response cannot orphan an event after Ungroup. */
  pendingCreateWrite?: CalendarEventWrite;
  conflict?: string;
  conflictAuthority?: 'unknown';
  pendingSourceScope?: 'occurrence' | 'series';
  pendingSourceOperationId?: string;
};

export type AccountSyncDiagnosticStep = 'ledger-list' | 'ledger-local' | 'ledger-read' | 'ledger-decrypt' | 'ledger-merge' |
  'ledger-prepare' | 'ledger-encrypt' | 'ledger-upload' | 'ledger-ack' | 'minute-links' |
  'activity-links' | 'activity-rank' | 'calendar-activity' | 'calendar-local' | 'calendar-event-read' | 'calendar-color' | 'calendar-event-write';
export type AccountSyncDiagnostics = {
  startedAt: number;
  finishedAt?: number;
  active: { step: AccountSyncDiagnosticStep; startedAt: number } | null;
  steps: { step: AccountSyncDiagnosticStep; calls: number; elapsedMs: number }[];
  crypto: import('./codec').LedgerCryptoDiagnostics;
};

export type AccountSyncStatus = {
  /** Process-local aggregate timing only; never persisted or sent to a provider. */
  diagnostics?: AccountSyncDiagnostics;
  running: boolean;
  lastSyncedAt: string | null;
  message: string;
  conflicts: number;
  outcome?: 'idle' | 'running' | 'continuing' | 'success' | 'error';
  phase?: 'idle' | 'checking-storage' | 'downloading' | 'uploading' | 'calendar';
  progress?: { completed: number; total?: number };
  /** One identity for a shared synchronization promise, including its follow-up pass. */
  cycleId?: number;
  cycleComplete?: boolean;
  /** Complete account downloads and no provider/conflict error; never inferred from a caller timeout. */
  nativeWriteReady?: boolean;
  nativePendingCount?: number;
};
