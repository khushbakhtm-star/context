export type MinuteEntry = {
  id: string;
  dateKey: string;
  minuteIndex: number;
  text: string;
  categoryId: string;
  blockId: string;
  source: 'manual' | 'inherited-plan' | 'imported';
  createdAt: string;
  updatedAt: string;
};

export type ActivitySegment = {
  segmentKey: string;
  blockId: string;
  dateKey: string;
  startMinute: number;
  endMinute: number;
  categoryId: string;
  entries: MinuteEntry[];
  /** Explicit activity title, separate from every minute's own note. */
  activityTitle?: string;
};

export type SyncBinding = {
  segmentKey: string;
  blockId: string;
  dateKey: string;
  calendarId: string;
  eventId: string;
  updatedAt: string;
};

export type DeviceCalendar = {
  id: string;
  title: string;
  color: string;
  allowsModifications: boolean;
  sourceName: string;
  isPrimary: boolean;
  isVisible?: boolean;
  isSynced?: boolean;
};

export type PlannedEvent = {
  id: string;
  calendarId: string;
  title: string;
  notes?: string;
  color: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  categoryId?: string;
  /** Read-only origin for preserving a source event's color on a new minute note. */
  sourceProvider?: 'google' | 'microsoft' | 'device';
  accountEvent?: {
    accountId: string;
    event: import('./sync/types').RemoteCalendarEvent;
  };
};

export type CalendarPreferences = {
  selectedCalendarIds: string[];
  writeCalendarId: string | null;
  syncActuals: boolean;
};

export type SearchResult = MinuteEntry & {
  categoryName: string;
  categoryColor: string;
};
