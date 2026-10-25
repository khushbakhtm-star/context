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
