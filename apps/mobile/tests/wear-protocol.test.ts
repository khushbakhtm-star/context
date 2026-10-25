import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWearInbox, wearCellVersion } from '../src/wear/protocol';
const id = '12345678-1234-1234-1234-123456789abc';
const operation = { version: 1, operationId: id, dateKey: '2026-10-25', minuteIndex: 1439,
  text: 'Talk to Mum ☕', baseKnown: true, expectedVersion: '[null,null]' };
const item = (value: unknown, path = `/context/v1/watch/edit/${id}`) =>
  ({ id: 'local', path, payload: JSON.stringify(value), receivedAt: 0 });

test('watch protocol retains text and exact minute coordinates across midnight', () => {
  const first = parseWearInbox(item(operation));
  assert.equal(first.kind, 'edit');
  if (first.kind === 'edit') { assert.equal(first.value.minuteIndex, 1439); assert.equal(first.value.text, 'Talk to Mum ☕'); }
  const next = parseWearInbox(item({ ...operation, dateKey: '2026-10-26', minuteIndex: 0 }));
  assert.equal(next.value.dateKey, '2026-10-26');
  assert.equal(wearCellVersion(null, null), '[null,null]');
});
test('watch protocol rejects invalid dates, coordinates, identities, versions and oversized notes', () => {
  for (const patch of [{ dateKey: '2026-02-30' }, { minuteIndex: 1440 }, { minuteIndex: -1 },
    { operationId: 'different' }, { version: 2 }, { baseKnown: 'yes' }, { expectedVersion: '["bad",null]' },
    { text: 'a'.repeat(50_001) }]) assert.throws(() => parseWearInbox(item({ ...operation, ...patch })));
  assert.throws(() => parseWearInbox(item(operation, `/context/v1/phone/ack/${id}`)));
});
test('watch protocol rejects prototype-bearing objects and unexpected nested payloads', () => {
  const malicious = JSON.parse(JSON.stringify(operation).replace(/}$/, ',"__proto__":{"polluted":true}}'));
  assert.throws(() => parseWearInbox(item(malicious)), /Invalid watch payload/);
  assert.throws(() => parseWearInbox(item({ ...operation, text: { constructor: 'bad' } })));
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});
test('watch day requests replay at most 32 immutable operation IDs within a bounded Asset', () => {
  const request = { version: 1, requestId: id, dateKey: '2026-10-25', pendingOperationIds: [id] };
  assert.equal(parseWearInbox(item(request, `/context/v1/watch/request/${id}`)).kind, 'request');
  assert.throws(() => parseWearInbox(item({ ...request, pendingOperationIds: Array(33).fill(id) }, `/context/v1/watch/request/${id}`)));
  assert.throws(() => parseWearInbox(item({ ...request, pendingOperationIds: ['bad'] }, `/context/v1/watch/request/${id}`)));
});
