/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivitySegment, SyncBinding } from '../src/types';
import { planNativeBoundRetime, type NativeBoundRetimeInput } from '../src/utils/native-bound-retime';

const blockId = 'activity_explicit_border';
const calendarId = 'opaque-selected-calendar';
const day = '2026-10-31';
function segment(dateKey = day, startMinute = 600, endMinute = 602): ActivitySegment {
  return { segmentKey: `${dateKey}:${blockId}:${startMinute}-${endMinute}`, blockId, dateKey, startMinute, endMinute,
    categoryId: 'study', activityTitle: 'Explicit activity', entries: Array.from({ length: endMinute - startMinute + 1 }, (_, offset) => ({
      id: `minute-${offset}`, dateKey, minuteIndex: startMinute + offset, blockId,
      text: offset === 0 ? 'First annotation' : offset === 1 ? '' : 'Separate annotation',
      categoryId: offset === 1 ? 'work' : 'study', source: 'manual', createdAt: 'created', updatedAt: 'updated',
    })) };
}
function binding(): SyncBinding {
  return { segmentKey: `${day}:${blockId}:600-602`, blockId, dateKey: day, calendarId, eventId: 'exact-original-event', updatedAt: 'binding-version' };
}
function input(target = segment(), processingDate = target.dateKey): NativeBoundRetimeInput {
  return { blockId, selectedCalendarId: calendarId, hasAccountOwner: false, bindings: [binding()], segments: [target], processingDate };
}

test('one exact explicit border can resize or move while preserving its sole calendar/event identity and every minute annotation', () => {
  for (const target of [segment(day, 590, 601), segment(day, 601, 601), segment(day, 615, 620), segment(day, 0, 0), segment(day, 1439, 1439)]) {
    const plan = planNativeBoundRetime(input(target));
    assert.equal(plan.kind, 'retime');
    assert.equal(plan.needsRemap, true); assert.deepEqual(plan.binding, binding());
    assert.deepEqual(plan.afterBinding, { segmentKey: target.segmentKey, blockId, dateKey: target.dateKey, calendarId,
      eventId: 'exact-original-event' });
    assert.deepEqual(plan.segment.entries, target.entries);
    assert.equal(Object.hasOwn(plan.afterBinding, 'updatedAt'), false, 'the database generates the new link version atomically');
  }
});

test('an across-day move defers old-day cleanup and emits the same-ID retime only on its target day, including DST/year boundaries', () => {
  for (const targetDay of ['2026-11-01', '2027-01-01', '1000-01-01', '9999-12-31']) {
    const target = segment(targetDay, 60, 63);
    const sourcePass = planNativeBoundRetime(input(target, day));
    assert.equal(sourcePass.kind, 'defer-source-cleanup');
    const targetPass = planNativeBoundRetime(input(target, targetDay));
    assert.equal(targetPass.kind, 'retime');
    assert.equal(sourcePass.sourceDate, day); assert.equal(sourcePass.targetDate, targetDay);
    assert.deepEqual(sourcePass.afterBinding, targetPass.afterBinding);
    assert.deepEqual(planNativeBoundRetime(input(target, '2026-10-30')), { kind: 'deferred', reason: 'unrelated-date' });
  }
});

test('crash retry still exposes the guarded rekey after a completed target write, then becomes unchanged only once the binding is committed', () => {
  const target = segment('2026-11-01', 450, 454);
  const state = input(target);
  // Receipts/remote hashes are verified by the caller. A previously completed
  // provider write cannot make the remaining old SQLite key disappear here.
  const first = planNativeBoundRetime(state);
  const retry = planNativeBoundRetime(state);
  assert.equal(first.kind, 'retime'); assert.deepEqual(retry, first);
  assert.equal(retry.needsRemap, true); assert.equal(retry.binding.segmentKey, binding().segmentKey);
  assert.equal(retry.afterBinding.segmentKey, target.segmentKey);
  const committed = planNativeBoundRetime({ ...state, bindings: [{ ...retry.afterBinding, updatedAt: 'committed-version' }] });
  assert.equal(committed.kind, 'unchanged');
  assert.equal(committed.needsRemap, false);
});

test('multiple global bindings/segments, absent segments and account ownership never choose an event or authorize cleanup', () => {
  const state = input();
  for (const bindings of [[], [binding(), { ...binding(), eventId: 'second-event' }],
    [binding(), { ...binding(), dateKey: '2026-11-01', segmentKey: `2026-11-01:${blockId}:600-602` }]]) {
    assert.deepEqual(planNativeBoundRetime({ ...state, bindings }), { kind: 'deferred', reason: 'ambiguous-bindings' });
  }
  for (const segments of [[], [segment(), segment(day, 610, 611)], [segment(), segment('2026-11-01')]]) {
    assert.deepEqual(planNativeBoundRetime({ ...state, segments }), { kind: 'deferred', reason: 'ambiguous-segments' });
  }
  assert.deepEqual(planNativeBoundRetime({ ...state, hasAccountOwner: true }), { kind: 'deferred', reason: 'account-owned' });
  assert.deepEqual(planNativeBoundRetime({ ...state, selectedCalendarId: 'other-calendar' }), { kind: 'deferred', reason: 'different-calendar' });
});

test('unbordered notes and malformed/noncontiguous geometry defer instead of inferring identity from a title or overlap', () => {
  for (const patch of [{ activityTitle: undefined }, { activityTitle: '  ' }, { activityTitle: 'x'.repeat(201) }]) {
    assert.deepEqual(planNativeBoundRetime(input({ ...segment(), ...patch })), { kind: 'deferred', reason: 'unbordered' });
  }
  const original = segment();
  const invalid: ActivitySegment[] = [
    { ...original, startMinute: -1 }, { ...original, endMinute: 1440 }, { ...original, dateKey: '2026-02-30' },
    { ...original, segmentKey: `${day}:${blockId}:600-605` },
    { ...original, entries: original.entries.slice(1) },
    { ...original, entries: original.entries.map((entry, index) => index === 1 ? { ...entry, minuteIndex: 603 } : entry) },
    { ...original, entries: original.entries.map((entry, index) => index === 1 ? { ...entry, dateKey: '2026-11-01' } : entry) },
    { ...original, entries: original.entries.map((entry, index) => index === 1 ? { ...entry, blockId: 'unrelated-block' } : entry) },
    { ...original, entries: original.entries.map((entry) => ({ ...entry, id: 'duplicate-id' })) },
  ];
  for (const target of invalid) assert.deepEqual(planNativeBoundRetime(input(target, day)), { kind: 'deferred', reason: 'invalid-segment' });
  for (const bad of [{ ...binding(), segmentKey: 'unproven-key' }, { ...binding(), dateKey: '2026-11-01' },
    { ...binding(), eventId: '' }, { ...binding(), blockId: 'unrelated-block' }]) {
    assert.deepEqual(planNativeBoundRetime({ ...input(), bindings: [bad] }), { kind: 'deferred', reason: 'invalid-input' });
  }
});

test('unchanged means interval identity only; plans preserve source snapshots and do not mutate or alias the caller state', () => {
  const state = input(); const original = JSON.stringify(state);
  const plan = planNativeBoundRetime(state);
  assert.equal(plan.kind, 'unchanged');
  assert.equal(plan.needsRemap, false); assert.equal(plan.segment.entries[0]!.text, 'First annotation');
  assert.equal(JSON.stringify(state), original);
  plan.binding.eventId = 'mutated-preview'; plan.segment.entries[0]!.text = 'mutated-preview';
  assert.equal(state.bindings[0]!.eventId, 'exact-original-event');
  assert.equal(state.segments[0]!.entries[0]!.text, 'First annotation');
});
