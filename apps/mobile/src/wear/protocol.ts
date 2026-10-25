export const WEAR_PROTOCOL_VERSION = 1;
export const WEAR_TEXT_LIMIT = 50_000;
export const WEAR_EDIT_BYTE_LIMIT = 256 * 1024;
export const WEAR_DAY_BYTE_LIMIT = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REVISION = /^\d{16}:\d{8}:[A-Za-z0-9_-]{8,128}$/;

export type WearEdit = { version: 1; operationId: string; dateKey: string; minuteIndex: number;
  text: string; categoryId?: string; baseKnown: boolean; expectedVersion: string | null };
export type WearDayRequest = { version: 1; requestId: string; dateKey: string; pendingOperationIds?: string[] };
export type WearCell = { minuteIndex: number; text: string; categoryId: string; version: string };
export type WearAck = { version: 1; operationId: string; dateKey: string; minuteIndex: number;
  status: 'applied' | 'conflict' | 'error'; message?: string; entry?: WearCell };
export type WearInboxItem = { id: string; path: string; payload: string; receivedAt: number };

export function wearDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function wearCellVersion(minuteRevision: string | null, formatRevision: string | null) {
  return JSON.stringify([minuteRevision, formatRevision]);
}
function validVersion(value: unknown) {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > 512) return false;
  try {
    const parts: unknown = JSON.parse(value);
    return Array.isArray(parts) && parts.length === 2 && parts.every((part) => part === null ||
      (typeof part === 'string' && REVISION.test(part))) && JSON.stringify(parts) === value;
  } catch { return false; }
}
function rejectPrototypeKeys(value: unknown, depth = 0) {
  if (depth > 8) throw new Error('Invalid watch payload.');
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Invalid watch payload.');
    rejectPrototypeKeys((value as Record<string, unknown>)[key], depth + 1);
  }
}
function record(payload: string, maxBytes: number, keys: string[]) {
  if (typeof payload !== 'string' || payload.length > maxBytes || new TextEncoder().encode(payload).byteLength > maxBytes) {
    throw new Error('Watch payload is too large.');
  }
  let value: unknown;
  try { value = JSON.parse(payload); } catch { throw new Error('Invalid watch JSON.'); }
  rejectPrototypeKeys(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid watch payload.');
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !keys.includes(key)) || item.version !== 1 || !wearDate(item.dateKey)) {
    throw new Error('Unsupported watch payload.');
  }
  return item;
}
export function parseWearInbox(item: WearInboxItem): { kind: 'edit'; value: WearEdit } | { kind: 'request'; value: WearDayRequest } {
  if (!item || typeof item.path !== 'string' || typeof item.payload !== 'string') throw new Error('Invalid watch inbox item.');
  const match = /^\/context\/v1\/watch\/(edit|request)\/([0-9a-f-]{36})$/i.exec(item.path);
  if (!match || !UUID.test(match[2]!)) throw new Error('Unknown watch path.');
  if (match[1] === 'request') {
    const value = record(item.payload, 2048, ['version', 'requestId', 'dateKey', 'pendingOperationIds']);
    if (value.requestId !== match[2] || (value.pendingOperationIds !== undefined &&
      (!Array.isArray(value.pendingOperationIds) || value.pendingOperationIds.length > 32 ||
        value.pendingOperationIds.some((id) => typeof id !== 'string' || !UUID.test(id))))) {
      throw new Error('Watch request identity does not match.');
    }
    return { kind: 'request', value: value as WearDayRequest };
  }
  const value = record(item.payload, WEAR_EDIT_BYTE_LIMIT,
    ['version', 'operationId', 'dateKey', 'minuteIndex', 'text', 'categoryId', 'baseKnown', 'expectedVersion']);
  if (value.operationId !== match[2] || !Number.isInteger(value.minuteIndex) ||
      (value.minuteIndex as number) < 0 || (value.minuteIndex as number) > 1439 || typeof value.text !== 'string' ||
      Array.from(value.text).length > WEAR_TEXT_LIMIT || typeof value.baseKnown !== 'boolean' ||
      !validVersion(value.expectedVersion) || (value.categoryId !== undefined &&
        (typeof value.categoryId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value.categoryId)))) {
    throw new Error('Invalid watch edit.');
  }
  return { kind: 'edit', value: value as WearEdit };
}
