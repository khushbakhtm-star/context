import * as SQLite from 'expo-sqlite';

import { CATEGORIES, categoryById } from '../theme';
import type { ActivitySegment, MinuteEntry, SearchResult, SyncBinding } from '../types';
import { addDays, dateKey } from '../utils/time';
import type { SyncDocument } from '../sync/types';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

function database() {
  databasePromise ??= SQLite.openDatabaseAsync('context.db').catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

type MinuteRow = {
  id: string;
  date_key: string;
  minute_index: number;
  text: string;
  category_id: string;
  block_id: string;
  source: MinuteEntry['source'];
  created_at: string;
  updated_at: string;
};

function mapMinuteRow(row: MinuteRow): MinuteEntry {
  return {
    id: row.id,
    dateKey: row.date_key,
    minuteIndex: row.minute_index,
    text: row.text,
    categoryId: row.category_id,
    blockId: row.block_id,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function initializeDatabase() {
  const db = await database();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS minute_entries (
      id TEXT PRIMARY KEY NOT NULL,
      date_key TEXT NOT NULL,
      minute_index INTEGER NOT NULL CHECK (minute_index >= 0 AND minute_index < 1440),
      text TEXT NOT NULL,
      category_id TEXT NOT NULL,
      block_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(date_key, minute_index)
    );

    CREATE INDEX IF NOT EXISTS minute_entries_date_idx
      ON minute_entries(date_key, minute_index);
    CREATE INDEX IF NOT EXISTS minute_entries_block_idx
      ON minute_entries(block_id, date_key, minute_index);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_bindings (
      segment_key TEXT PRIMARY KEY NOT NULL,
      block_id TEXT NOT NULL,
      date_key TEXT NOT NULL,
      calendar_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sync_bindings_date_idx
      ON sync_bindings(date_key);

    CREATE TABLE IF NOT EXISTS sync_outbox (
      date_key TEXT PRIMARY KEY NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inline_minute_link_outbox (
      date_key TEXT NOT NULL,
      minute_index INTEGER NOT NULL CHECK (minute_index >= 0 AND minute_index < 1440),
      affected_dates_json TEXT NOT NULL,
      token TEXT NOT NULL,
      PRIMARY KEY(date_key, minute_index)
    );

    CREATE TABLE IF NOT EXISTS ledger_clock (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      wall INTEGER NOT NULL,
      counter INTEGER NOT NULL,
      device TEXT NOT NULL,
      importing INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO ledger_clock (id, wall, counter, device)
      VALUES (1, 0, 0, lower(hex(randomblob(16))));
    CREATE TABLE IF NOT EXISTS ledger_documents (
      key TEXT PRIMARY KEY NOT NULL,
      revision TEXT NOT NULL,
      value_json TEXT,
      local_pending INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS ledger_uploads (
      storage_key TEXT NOT NULL,
      document_key TEXT NOT NULL,
      revision TEXT NOT NULL,
      PRIMARY KEY(storage_key, document_key)
    );
    CREATE TABLE IF NOT EXISTS ledger_files (
      storage_key TEXT NOT NULL,
      file_id TEXT NOT NULL,
      PRIMARY KEY(storage_key, file_id)
    );
    CREATE TABLE IF NOT EXISTS ledger_conflicts (
      key TEXT NOT NULL,
      revision TEXT NOT NULL,
      value_json TEXT,
      PRIMARY KEY(key, revision)
    );

    CREATE TRIGGER IF NOT EXISTS ledger_minute_insert AFTER INSERT ON minute_entries
      WHEN (SELECT importing FROM ledger_clock WHERE id = 1) = 0
    BEGIN
      UPDATE ledger_clock SET
        counter = CASE WHEN wall >= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
          THEN counter + 1 ELSE 0 END,
        wall = max(wall, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
        WHERE id = 1;
      INSERT INTO ledger_documents (key, revision, value_json, local_pending)
        SELECT 'minute:' || NEW.date_key || ':' || NEW.minute_index,
          printf('%016d:%08d:%s', wall, counter, device),
          json_object('id', NEW.id, 'dateKey', NEW.date_key, 'minuteIndex', NEW.minute_index,
            'text', NEW.text, 'categoryId', NEW.category_id, 'blockId', NEW.block_id,
            'source', NEW.source, 'createdAt', NEW.created_at, 'updatedAt', NEW.updated_at), 1
        FROM ledger_clock WHERE id = 1
        ON CONFLICT(key) DO UPDATE SET revision = excluded.revision,
          value_json = excluded.value_json, local_pending = 1;
    END;
    CREATE TRIGGER IF NOT EXISTS ledger_minute_update AFTER UPDATE ON minute_entries
      WHEN (SELECT importing FROM ledger_clock WHERE id = 1) = 0
    BEGIN
      UPDATE ledger_clock SET
        counter = CASE WHEN wall >= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
          THEN counter + 1 ELSE 0 END,
        wall = max(wall, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
        WHERE id = 1;
      INSERT INTO ledger_documents (key, revision, value_json, local_pending)
        SELECT 'minute:' || NEW.date_key || ':' || NEW.minute_index,
          printf('%016d:%08d:%s', wall, counter, device),
          json_object('id', NEW.id, 'dateKey', NEW.date_key, 'minuteIndex', NEW.minute_index,
            'text', NEW.text, 'categoryId', NEW.category_id, 'blockId', NEW.block_id,
            'source', NEW.source, 'createdAt', NEW.created_at, 'updatedAt', NEW.updated_at), 1
        FROM ledger_clock WHERE id = 1
        ON CONFLICT(key) DO UPDATE SET revision = excluded.revision,
          value_json = excluded.value_json, local_pending = 1;
    END;
    CREATE TRIGGER IF NOT EXISTS ledger_minute_delete AFTER DELETE ON minute_entries
      WHEN (SELECT importing FROM ledger_clock WHERE id = 1) = 0
    BEGIN
      UPDATE ledger_clock SET
        counter = CASE WHEN wall >= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
          THEN counter + 1 ELSE 0 END,
        wall = max(wall, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
        WHERE id = 1;
      INSERT INTO ledger_documents (key, revision, value_json, local_pending)
        SELECT 'minute:' || OLD.date_key || ':' || OLD.minute_index,
          printf('%016d:%08d:%s', wall, counter, device), NULL, 1
        FROM ledger_clock WHERE id = 1
        ON CONFLICT(key) DO UPDATE SET revision = excluded.revision,
          value_json = NULL, local_pending = 1;
    END;
  `);

  // Seed older installations without changing their content or creating fake calendar writes.
  await db.runAsync(`INSERT OR IGNORE INTO ledger_documents (key, revision, value_json)
    SELECT 'minute:' || date_key || ':' || minute_index,
      printf('%016d:%08d:%s',
        max(0, CAST((julianday(updated_at) - 2440587.5) * 86400000 AS INTEGER)),
        minute_index, (SELECT device FROM ledger_clock WHERE id = 1)),
      json_object('id', id, 'dateKey', date_key, 'minuteIndex', minute_index,
        'text', text, 'categoryId', category_id, 'blockId', block_id,
        'source', source, 'createdAt', created_at, 'updatedAt', updated_at)
    FROM minute_entries`);
  const latestRevision = await db.getFirstAsync<{ revision: string }>(
    `SELECT revision FROM ledger_documents ORDER BY revision DESC LIMIT 1`,
  );
  if (latestRevision) {
    const [wall, counter] = latestRevision.revision.split(':').map(Number);
    await db.runAsync(`UPDATE ledger_clock SET
      counter = CASE WHEN wall = ? THEN max(counter, ?) WHEN wall < ? THEN ? ELSE counter END,
      wall = max(wall, ?) WHERE id = 1`, wall!, counter!, wall!, counter!, wall!);
  }

  for (const [index, category] of CATEGORIES.entries()) {
    await db.runAsync(
      `INSERT OR IGNORE INTO categories (id, name, color, sort_order) VALUES (?, ?, ?, ?)`,
      category.id,
      category.name,
      category.color,
      index,
    );
  }
}

export async function getDayEntries(value: string) {
  const db = await database();
  const rows = await db.getAllAsync<MinuteRow>(
    `SELECT * FROM minute_entries WHERE date_key = ? ORDER BY minute_index`,
    value,
  );
  return rows.map(mapMinuteRow);
}

export async function getMinuteEntry(value: string, minuteIndex: number) {
  const db = await database();
  const row = await db.getFirstAsync<MinuteRow>(
    `SELECT * FROM minute_entries WHERE date_key = ? AND minute_index = ?`,
    value,
    minuteIndex,
  );
  return row ? mapMinuteRow(row) : null;
}

export async function saveMinuteEntry(input: {
  dateKey: string;
  minuteIndex: number;
  text: string;
  categoryId: string;
}) {
  const text = input.text.trim();
  if (!text) {
    await deleteMinuteEntry(input.dateKey, input.minuteIndex);
    return null;
  }
  await saveMinuteRange({
    dateKey: input.dateKey,
    startMinute: input.minuteIndex,
    durationMinutes: 1,
    text,
    categoryId: input.categoryId,
  });
  return getMinuteEntry(input.dateKey, input.minuteIndex);
}

export async function saveMinuteRange(input: {
  dateKey: string;
  startMinute: number;
  durationMinutes: number;
  text: string;
  categoryId: string;
  /** Explicit color-only recording; ordinary blank text keeps existing caller semantics. */
  allowEmptyText?: boolean;
  /** Queue this explicit inline edit for account linking in the same local transaction. */
  queueInlineLink?: boolean;
}) {
  const db = await database();
  const text = input.text.trim();
  const duration = Math.max(1, Math.min(Math.trunc(input.durationMinutes), 24 * 60));
  const startMinute = Math.max(0, Math.min(Math.trunc(input.startMinute), 1439));
  if (!text && !input.allowEmptyText) return [] as string[];

  const now = new Date().toISOString();
  const affectedDates = new Set<string>();
  const coordinateAt = (absoluteMinute: number) => {
    const dayOffset = Math.floor(absoluteMinute / 1440);
    const minuteIndex = ((absoluteMinute % 1440) + 1440) % 1440;
    return {
      date: dateKey(addDays(input.dateKey, dayOffset)),
      minuteIndex,
    };
  };
  const coordinates = Array.from({ length: duration }, (_, offset) =>
    coordinateAt(startMinute + offset),
  );
  for (const coordinate of coordinates) affectedDates.add(coordinate.date);

  await db.withExclusiveTransactionAsync(async (txn) => {
    const existingByCoordinate = new Map<string, MinuteRow>();
    for (const targetDate of affectedDates) {
      const rows = await txn.getAllAsync<MinuteRow>(
        `SELECT * FROM minute_entries WHERE date_key = ?`,
        targetDate,
      );
      for (const row of rows) {
        existingByCoordinate.set(`${row.date_key}:${row.minute_index}`, row);
      }
    }

    const readBoundary = async (absoluteMinute: number) => {
      const coordinate = coordinateAt(absoluteMinute);
      const cached = existingByCoordinate.get(`${coordinate.date}:${coordinate.minuteIndex}`);
      if (cached) return cached;
      return txn.getFirstAsync<MinuteRow>(
        `SELECT * FROM minute_entries WHERE date_key = ? AND minute_index = ?`,
        coordinate.date,
        coordinate.minuteIndex,
      );
    };

    const existingStart = existingByCoordinate.get(
      `${coordinates[0]!.date}:${coordinates[0]!.minuteIndex}`,
    );
    const [previous, next] = await Promise.all([
      readBoundary(startMinute - 1),
      readBoundary(startMinute + duration),
    ]);
    const internalMatches = coordinates
      .map((coordinate) =>
        existingByCoordinate.get(`${coordinate.date}:${coordinate.minuteIndex}`),
      )
      .filter(
        (row): row is MinuteRow => Boolean(row && row.category_id === input.categoryId),
      );
    const matchingRows = [
      existingStart?.category_id === input.categoryId ? existingStart : null,
      previous?.category_id === input.categoryId ? previous : null,
      next?.category_id === input.categoryId ? next : null,
      ...internalMatches,
    ].filter((row): row is MinuteRow => Boolean(row));
    const blockId = matchingRows[0]?.block_id ?? makeId('block');
    const blocksToMerge = [
      ...new Set(
        matchingRows
          .map((row) => row.block_id)
          .filter((candidate) => candidate !== blockId),
      ),
    ];

    for (const mergedBlockId of blocksToMerge) {
      const mergedDates = await txn.getAllAsync<{ date_key: string }>(
        `SELECT DISTINCT date_key FROM minute_entries WHERE block_id = ?`,
        mergedBlockId,
      );
      for (const row of mergedDates) affectedDates.add(row.date_key);
      await txn.runAsync(
        `UPDATE minute_entries SET block_id = ?, updated_at = ? WHERE block_id = ?`,
        blockId,
        now,
        mergedBlockId,
      );
    }

    for (const coordinate of coordinates) {
      await txn.runAsync(
        `INSERT INTO minute_entries
          (id, date_key, minute_index, text, category_id, block_id, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?)
         ON CONFLICT(date_key, minute_index) DO UPDATE SET
           text = excluded.text,
           category_id = excluded.category_id,
           block_id = excluded.block_id,
           source = 'manual',
           updated_at = excluded.updated_at`,
        makeId('minute'),
        coordinate.date,
        coordinate.minuteIndex,
        text,
        input.categoryId,
        blockId,
        now,
        now,
      );
    }
    for (const targetDate of affectedDates) {
      await txn.runAsync(
        `INSERT INTO sync_outbox (date_key, attempts, last_error, updated_at)
         VALUES (?, 0, NULL, ?)
         ON CONFLICT(date_key) DO UPDATE SET
           attempts = 0, last_error = NULL, updated_at = excluded.updated_at`,
        targetDate,
        now,
      );
    }
    if (input.queueInlineLink) {
      await queueInlineMinuteLink(txn, input.dateKey, startMinute, [...affectedDates]);
    }
  });

  return [...affectedDates];
}

export async function deleteMinuteEntry(value: string, minuteIndex: number,
  options: { queueInlineLink?: boolean } = {}) {
  const db = await database();
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `DELETE FROM minute_entries WHERE date_key = ? AND minute_index = ?`,
      value,
      minuteIndex,
    );
    await txn.runAsync(
      `INSERT INTO sync_outbox (date_key, attempts, last_error, updated_at)
       VALUES (?, 0, NULL, ?)
       ON CONFLICT(date_key) DO UPDATE SET
         attempts = 0, last_error = NULL, updated_at = excluded.updated_at`,
      value,
      now,
    );
    if (options.queueInlineLink) await queueInlineMinuteLink(txn, value, minuteIndex, [value]);
  });
}

export type PendingInlineMinuteLink = {
  dateKey: string;
  minuteIndex: number;
  affectedDates: string[];
  token: string;
};

async function queueInlineMinuteLink(txn: Pick<SQLite.SQLiteDatabase, 'runAsync' | 'getFirstAsync'>,
  value: string, minuteIndex: number, affectedDates: string[]) {
  const pending = await txn.getFirstAsync<{ affected_dates_json: string }>(
    `SELECT affected_dates_json FROM inline_minute_link_outbox WHERE date_key = ? AND minute_index = ?`,
    value, minuteIndex,
  );
  // A second edit must retain every date touched by the earlier unacknowledged block merge.
  const dates = [...new Set<string>([...(pending ? JSON.parse(pending.affected_dates_json) as string[] : []),
    ...affectedDates])];
  await txn.runAsync(`INSERT INTO inline_minute_link_outbox
    (date_key, minute_index, affected_dates_json, token) VALUES (?, ?, ?, ?)
    ON CONFLICT(date_key, minute_index) DO UPDATE SET
      affected_dates_json = excluded.affected_dates_json, token = excluded.token`,
    value, minuteIndex, JSON.stringify(dates), makeId('inline_link'));
}

/** Only explicit inline edits enter this queue; historical device-calendar outbox rows are not replayed. */
export async function getPendingInlineMinuteLinks(limit = 100): Promise<PendingInlineMinuteLink[]> {
  const db = await database();
  const rows = await db.getAllAsync<{
    date_key: string; minute_index: number; affected_dates_json: string; token: string;
  }>(`SELECT date_key, minute_index, affected_dates_json, token FROM inline_minute_link_outbox
    ORDER BY rowid LIMIT ?`, Math.max(1, Math.min(500, Math.trunc(limit) || 100)));
  return rows.map((row) => ({ dateKey: row.date_key, minuteIndex: row.minute_index,
    affectedDates: JSON.parse(row.affected_dates_json) as string[], token: row.token }));
}

/** Acknowledging an older attempt cannot remove a newer edit queued at the same minute. */
export async function acknowledgeInlineMinuteLink(item: Pick<PendingInlineMinuteLink, 'dateKey' | 'minuteIndex' | 'token'>) {
  const db = await database();
  const result = await db.runAsync(`DELETE FROM inline_minute_link_outbox
    WHERE date_key = ? AND minute_index = ? AND token = ?`, item.dateKey, item.minuteIndex, item.token);
  return result.changes > 0;
}

export async function getDaySegments(value: string): Promise<ActivitySegment[]> {
  const entries = await getDayEntries(value);
  const segments: ActivitySegment[] = [];
  for (const entry of entries) {
    const previous = segments.at(-1);
    if (
      previous &&
      previous.blockId === entry.blockId &&
      previous.categoryId === entry.categoryId &&
      previous.endMinute + 1 === entry.minuteIndex
    ) {
      previous.entries.push(entry);
      previous.endMinute = entry.minuteIndex;
      previous.segmentKey = `${value}:${previous.blockId}:${previous.startMinute}-${previous.endMinute}`;
      continue;
    }
    segments.push({
      segmentKey: `${value}:${entry.blockId}:${entry.minuteIndex}-${entry.minuteIndex}`,
      blockId: entry.blockId,
      dateKey: value,
      startMinute: entry.minuteIndex,
      endMinute: entry.minuteIndex,
      categoryId: entry.categoryId,
      entries: [entry],
    });
  }
  return segments;
}

export async function searchEntries(query: string, limit = 100): Promise<SearchResult[]> {
  const db = await database();
  const rows = await db.getAllAsync<MinuteRow>(
    `SELECT * FROM minute_entries
     WHERE text LIKE ? ESCAPE '\\'
     ORDER BY date_key DESC, minute_index DESC
     LIMIT ?`,
    `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`,
    limit,
  );
  return rows.map((row) => {
    const entry = mapMinuteRow(row);
    const category = categoryById(entry.categoryId);
    return { ...entry, categoryName: category.name, categoryColor: category.color };
  });
}

export async function getEntriesBetween(startDate: string, endDate: string) {
  const db = await database();
  const rows = await db.getAllAsync<MinuteRow>(
    `SELECT * FROM minute_entries
     WHERE date_key >= ? AND date_key <= ?
     ORDER BY date_key, minute_index`,
    startDate,
    endDate,
  );
  return rows.map(mapMinuteRow);
}

export async function getCategoryTimeTotals(startDate: string, endDate: string) {
  const db = await database();
  return db.getAllAsync<{ dateKey: string; categoryId: string; minutes: number }>(
    `SELECT date_key AS dateKey, category_id AS categoryId, COUNT(*) AS minutes
     FROM minute_entries WHERE date_key >= ? AND date_key <= ?
     GROUP BY date_key, category_id ORDER BY date_key, category_id`,
    startDate, endDate,
  );
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const db = await database();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM settings WHERE key = ?`,
    key,
  );
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function setSetting<T>(key: string, value: T) {
  const db = await database();
  await db.runAsync(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    JSON.stringify(value),
    new Date().toISOString(),
  );
}

export async function getSyncBindings(value: string): Promise<SyncBinding[]> {
  const db = await database();
  const rows = await db.getAllAsync<{
    segment_key: string;
    block_id: string;
    date_key: string;
    calendar_id: string;
    event_id: string;
    updated_at: string;
  }>(`SELECT * FROM sync_bindings WHERE date_key = ?`, value);
  return rows.map((row) => ({
    segmentKey: row.segment_key,
    blockId: row.block_id,
    dateKey: row.date_key,
    calendarId: row.calendar_id,
    eventId: row.event_id,
    updatedAt: row.updated_at,
  }));
}

export async function saveSyncBinding(binding: Omit<SyncBinding, 'updatedAt'>, oldKey?: string) {
  const db = await database();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `INSERT INTO sync_bindings
        (segment_key, block_id, date_key, calendar_id, event_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(segment_key) DO UPDATE SET
         block_id = excluded.block_id,
         date_key = excluded.date_key,
         calendar_id = excluded.calendar_id,
         event_id = excluded.event_id,
         updated_at = excluded.updated_at`,
      binding.segmentKey,
      binding.blockId,
      binding.dateKey,
      binding.calendarId,
      binding.eventId,
      new Date().toISOString(),
    );
    if (oldKey && oldKey !== binding.segmentKey) {
      await txn.runAsync(`DELETE FROM sync_bindings WHERE segment_key = ?`, oldKey);
    }
  });
}

export async function deleteSyncBinding(segmentKey: string) {
  const db = await database();
  await db.runAsync(`DELETE FROM sync_bindings WHERE segment_key = ?`, segmentKey);
}

export type SyncOutboxItem = {
  dateKey: string;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
};

export async function getPendingSyncDates(limit = 31): Promise<SyncOutboxItem[]> {
  const db = await database();
  const rows = await db.getAllAsync<{
    date_key: string;
    attempts: number;
    last_error: string | null;
    updated_at: string;
  }>(
    `SELECT date_key, attempts, last_error, updated_at
     FROM sync_outbox
     ORDER BY attempts, updated_at DESC
     LIMIT ?`,
    limit,
  );
  return rows.map((row) => ({
    dateKey: row.date_key,
    attempts: row.attempts,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  }));
}

export async function getPendingSyncDatesFor(values: string[]): Promise<SyncOutboxItem[]> {
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length === 0) return [];
  const db = await database();
  const placeholders = uniqueValues.map(() => '?').join(', ');
  const rows = await db.getAllAsync<{
    date_key: string;
    attempts: number;
    last_error: string | null;
    updated_at: string;
  }>(
    `SELECT date_key, attempts, last_error, updated_at
     FROM sync_outbox
     WHERE date_key IN (${placeholders})`,
    ...uniqueValues,
  );
  return rows.map((row) => ({
    dateKey: row.date_key,
    attempts: row.attempts,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  }));
}

export async function enqueueBoundDatesForSync() {
  const db = await database();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO sync_outbox (date_key, attempts, last_error, updated_at)
     SELECT DISTINCT date_key, 0, NULL, ? FROM sync_bindings WHERE 1
     ON CONFLICT(date_key) DO UPDATE SET
       attempts = 0, last_error = NULL, updated_at = excluded.updated_at`,
    now,
  );
}

export async function markSyncDateComplete(value: string, queuedAt: string) {
  const db = await database();
  await db.runAsync(
    `DELETE FROM sync_outbox WHERE date_key = ? AND updated_at = ?`,
    value,
    queuedAt,
  );
}

export async function markSyncDateFailed(value: string, queuedAt: string, error: unknown) {
  const db = await database();
  const message = error instanceof Error ? error.message : String(error);
  await db.runAsync(
    `UPDATE sync_outbox
     SET attempts = attempts + 1, last_error = ?
     WHERE date_key = ? AND updated_at = ?`,
    message.slice(0, 500),
    value,
    queuedAt,
  );
}

type DocumentRow = {
  key: string;
  revision: string;
  value_json: string | null;
  local_pending: number;
};

function mapDocument(row: DocumentRow): SyncDocument {
  return { key: row.key, revision: row.revision, value: row.value_json ? JSON.parse(row.value_json) : null };
}

function canonicalValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function getSyncDocuments(prefix: string) {
  const db = await database();
  const rows = await db.getAllAsync<DocumentRow>(
    `SELECT * FROM ledger_documents WHERE substr(key, 1, ?) = ? ORDER BY key`,
    prefix.length, prefix,
  );
  return rows.map(mapDocument);
}

export async function putSyncDocument(key: string, value: Record<string, unknown> | null) {
  const db = await database();
  await db.withExclusiveTransactionAsync(async (txn) => {
    const wall = Date.now();
    await txn.runAsync(`UPDATE ledger_clock SET
      counter = CASE WHEN wall >= ? THEN counter + 1 ELSE 0 END,
      wall = max(wall, ?) WHERE id = 1`, wall, wall);
    await txn.runAsync(`INSERT INTO ledger_documents (key, revision, value_json, local_pending)
      SELECT ?, printf('%016d:%08d:%s', wall, counter, device), ?, 1
      FROM ledger_clock WHERE id = 1
      ON CONFLICT(key) DO UPDATE SET revision = excluded.revision,
        value_json = excluded.value_json, local_pending = 1`,
      key, value === null ? null : JSON.stringify(value));
  });
}

export async function getDocumentsForUpload(storageKey: string, limit = 200) {
  const db = await database();
  const rows = await db.getAllAsync<DocumentRow>(`SELECT d.* FROM ledger_documents d
    LEFT JOIN ledger_uploads u ON u.document_key = d.key AND u.storage_key = ?
    WHERE u.revision IS NULL OR u.revision <> d.revision
    ORDER BY d.key LIMIT ?`, storageKey, limit);
  return rows.map(mapDocument);
}

export async function acknowledgeUploaded(storageKey: string, documents: SyncDocument[]) {
  const db = await database();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const document of documents) {
      await txn.runAsync(`INSERT INTO ledger_uploads (storage_key, document_key, revision)
        VALUES (?, ?, ?) ON CONFLICT(storage_key, document_key)
        DO UPDATE SET revision = excluded.revision`, storageKey, document.key, document.revision);
      await txn.runAsync(`UPDATE ledger_documents SET local_pending = 0
        WHERE key = ? AND revision = ?`, document.key, document.revision);
    }
  });
}

export async function hasSeenSyncFile(storageKey: string, fileId: string) {
  const db = await database();
  return Boolean(await db.getFirstAsync(`SELECT 1 FROM ledger_files
    WHERE storage_key = ? AND file_id = ?`, storageKey, fileId));
}

export async function markSyncFileSeen(storageKey: string, fileId: string) {
  const db = await database();
  await db.runAsync(`INSERT OR IGNORE INTO ledger_files (storage_key, file_id) VALUES (?, ?)`,
    storageKey, fileId);
}

function requireMinuteDocument(document: SyncDocument) {
  const match = /^minute:(\d{4}-\d{2}-\d{2}):(\d{1,4})$/.exec(document.key);
  if (!match || Number(match[2]) >= 1440) throw new Error('Invalid synchronized minute key.');
  const value = document.value;
  if (value && (value.dateKey !== match[1] || value.minuteIndex !== Number(match[2]) ||
    typeof value.text !== 'string' || typeof value.categoryId !== 'string' ||
    typeof value.blockId !== 'string' || typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string')) {
    throw new Error('Invalid synchronized minute content.');
  }
  return { date: match[1]!, minute: Number(match[2]) };
}

/** Apply a whole verified batch atomically. Tombstones participate in the same total order. */
export async function mergeSyncDocuments(documents: SyncDocument[]) {
  const db = await database();
  let changed = 0;
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(`UPDATE ledger_clock SET importing = 1 WHERE id = 1`);
    for (const incoming of documents) {
      const existing = await txn.getFirstAsync<DocumentRow>(
        `SELECT * FROM ledger_documents WHERE key = ?`, incoming.key,
      );
      const [wallText, counterText] = incoming.revision.split(':');
      const remoteWall = Number(wallText);
      const remoteCounter = Number(counterText);
      await txn.runAsync(`UPDATE ledger_clock SET
        counter = CASE WHEN wall = ? THEN max(counter, ?) WHEN wall < ? THEN ? ELSE counter END,
        wall = max(wall, ?) WHERE id = 1`, remoteWall, remoteCounter, remoteWall,
        remoteCounter, remoteWall);
      if (existing?.revision === incoming.revision) {
        const existingValue = existing.value_json === null ? null : JSON.parse(existing.value_json);
        if (canonicalValue(existingValue) !== canonicalValue(incoming.value)) {
          throw new Error('Conflicting ledger values have the same revision.');
        }
        continue;
      }
      const incomingJson = incoming.value === null ? null : JSON.stringify(incoming.value);
      if (existing && existing.value_json !== incomingJson) {
        const loser = existing.revision > incoming.revision
          ? { revision: incoming.revision, value_json: incomingJson }
          : existing;
        await txn.runAsync(`INSERT OR IGNORE INTO ledger_conflicts
          (key, revision, value_json) VALUES (?, ?, ?)`, incoming.key,
          loser.revision, loser.value_json);
      }
      if (existing && existing.revision > incoming.revision) continue;

      if (incoming.key.startsWith('minute:')) {
        const coordinate = requireMinuteDocument(incoming);
        if (incoming.value === null) {
          await txn.runAsync(`DELETE FROM minute_entries WHERE date_key = ? AND minute_index = ?`,
            coordinate.date, coordinate.minute);
        } else {
          const value = incoming.value;
          await txn.runAsync(`INSERT INTO minute_entries
            (id, date_key, minute_index, text, category_id, block_id, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'imported', ?, ?)
            ON CONFLICT(date_key, minute_index) DO UPDATE SET text = excluded.text,
              category_id = excluded.category_id, block_id = excluded.block_id,
              source = excluded.source, created_at = excluded.created_at, updated_at = excluded.updated_at`,
            `synced:${coordinate.date}:${coordinate.minute}`, coordinate.date, coordinate.minute,
            value.text as string, value.categoryId as string, value.blockId as string,
            value.createdAt as string, value.updatedAt as string);
        }
      } else if (!incoming.key.startsWith('projection:') && !incoming.key.startsWith('category:')) {
        throw new Error('Unrecognized synchronization record.');
      }
      await txn.runAsync(`INSERT INTO ledger_documents (key, revision, value_json, local_pending)
        VALUES (?, ?, ?, 0) ON CONFLICT(key) DO UPDATE SET revision = excluded.revision,
          value_json = excluded.value_json, local_pending = 0`, incoming.key,
          incoming.revision, incomingJson);
      changed += 1;
    }
    await txn.runAsync(`UPDATE ledger_clock SET importing = 0 WHERE id = 1`);
  });
  return changed;
}

export async function getLedgerConflicts() {
  const db = await database();
  const rows = await db.getAllAsync<DocumentRow>(`SELECT key, revision, value_json, 0 AS local_pending
    FROM ledger_conflicts WHERE key LIKE 'minute:%' ORDER BY revision DESC LIMIT 100`);
  return rows.map(mapDocument);
}

export async function dismissLedgerConflict(key: string, revision: string) {
  const db = await database();
  await db.runAsync(`DELETE FROM ledger_conflicts WHERE key = ? AND revision = ?`, key, revision);
}

export async function restoreLedgerConflict(document: SyncDocument) {
  if (document.key.startsWith('minute:')) {
    const coordinate = requireMinuteDocument(document);
    if (document.value === null) await deleteMinuteEntry(coordinate.date, coordinate.minute);
    else await saveMinuteRange({ dateKey: coordinate.date, startMinute: coordinate.minute, durationMinutes: 1,
      text: document.value.text as string, categoryId: document.value.categoryId as string, allowEmptyText: true });
  } else await putSyncDocument(document.key, document.value);
  await dismissLedgerConflict(document.key, document.revision);
}

/** Calendar imports update the minute ledger and cloud journal in one transaction. */
export async function replaceProjectedMinutes(input: {
  blockId: string;
  previousDate: string;
  previousEndDate?: string;
  previousStart: number;
  previousEnd: number;
  expectedEntries?: MinuteEntry[];
  entries: { dateKey: string; minuteIndex: number; text: string; categoryId: string }[];
}) {
  const db = await database();
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (txn) => {
    const endDate = input.previousEndDate ?? input.previousDate;
    if (input.expectedEntries) {
      const current = await txn.getAllAsync<MinuteRow>(`SELECT * FROM minute_entries
        WHERE block_id = ?
          AND (date_key > ? OR (date_key = ? AND minute_index >= ?))
          AND (date_key < ? OR (date_key = ? AND minute_index <= ?))
        ORDER BY date_key, minute_index`, input.blockId, input.previousDate,
        input.previousDate, input.previousStart, endDate, endDate, input.previousEnd);
      if (canonicalValue(current.map(mapMinuteRow)) !== canonicalValue(input.expectedEntries)) {
        throw new Error('The local activity changed during calendar import. Review both versions.');
      }
    }
    await txn.runAsync(`DELETE FROM minute_entries WHERE block_id = ?
      AND (date_key > ? OR (date_key = ? AND minute_index >= ?))
      AND (date_key < ? OR (date_key = ? AND minute_index <= ?))`,
      input.blockId, input.previousDate, input.previousDate, input.previousStart,
      endDate, endDate, input.previousEnd);
    for (const entry of input.entries) {
      const existing = await txn.getFirstAsync<{ block_id: string }>(
        `SELECT block_id FROM minute_entries WHERE date_key = ? AND minute_index = ?`,
        entry.dateKey, entry.minuteIndex);
      if (existing && existing.block_id !== input.blockId) {
        throw new Error('This calendar edit overlaps another recorded activity. Resolve it in Context.');
      }
      await txn.runAsync(`INSERT INTO minute_entries
        (id, date_key, minute_index, text, category_id, block_id, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'imported', ?, ?)
        ON CONFLICT(date_key, minute_index) DO UPDATE SET text = excluded.text,
          category_id = excluded.category_id, block_id = excluded.block_id,
          source = 'imported', updated_at = excluded.updated_at`,
        makeId('minute'), entry.dateKey, entry.minuteIndex, entry.text, entry.categoryId,
        input.blockId, now, now);
    }
  });
}
