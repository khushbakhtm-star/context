/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivitySegment, MinuteEntry } from '../src/types';
import { activityIntervalAbsoluteEnd, activityIntervalContains, activityIntervalRanges, bindingInterval,
  coalesceNativeActivitySpan } from '../src/utils/activity-translation';
import { planNativeBoundRetime } from '../src/utils/native-bound-retime';

function night() {
  const blockId = 'activity_overnight';
  const entries: MinuteEntry[] = Array.from({ length: 5 }, (_, index) => ({ id: `entry-${index}`,
    dateKey: index < 2 ? '2026-12-31' : '2027-01-01', minuteIndex: index < 2 ? 1438 + index : index - 2,
    text: index === 1 ? '' : `Note ${index}`, categoryId: index < 2 ? 'study' : 'work', blockId,
    source: 'manual', createdAt: 'created', updatedAt: 'updated' }));
  const parts: ActivitySegment[] = [entries.slice(0, 2), entries.slice(2)].map((members) => ({
    blockId, dateKey: members[0]!.dateKey, startMinute: members[0]!.minuteIndex,
    endMinute: members.at(-1)!.minuteIndex, segmentKey: `${members[0]!.dateKey}:${blockId}:${members[0]!.minuteIndex}-${members.at(-1)!.minuteIndex}`,
    activityTitle: 'Night activity', categoryId: members[0]!.categoryId, entries: members }));
  return { blockId, entries, parts };
}

test('native binding intervals keep old keys unchanged and resolve bounded absolute overnight endpoints into exact civil ranges', () => {
  const old = bindingInterval('2026-12-31:activity_overnight:100-102', 'activity_overnight')!;
  assert.deepEqual(old, { key: '2026-12-31:activity_overnight:100-102', dateKey: '2026-12-31', startMinute: 100, endMinute: 102 });
  const value = bindingInterval('2026-12-31:activity_overnight:1438-1442', 'activity_overnight')!;
  assert.equal(value.endDateKey, '2027-01-01'); assert.equal(value.endMinute, 2);
  assert.equal(activityIntervalAbsoluteEnd(value), 1442);
  assert.deepEqual(activityIntervalRanges(value), [
    { dateKey: '2026-12-31', startMinute: 1438, endMinute: 1439 }, { dateKey: '2027-01-01', startMinute: 0, endMinute: 2 }]);
  assert.ok(activityIntervalContains(value, { dateKey: '2027-01-01', minuteIndex: 2 }));
  assert.equal(activityIntervalContains(value, { dateKey: '2026-12-31', minuteIndex: 2 }), false);
  for (const key of ['2026-12-31:activity_overnight:1438-2878', '2026-12-31:activity_overnight:1440-1441',
    '9999-12-31:activity_overnight:1438-1441', '2026-02-30:activity_overnight:1-2']) {
    assert.equal(bindingInterval(key, 'activity_overnight'), null);
  }
});

test('complete identically titled midnight parts become one detached native span while private colors and blank annotations remain intact', () => {
  const { entries, parts } = night();
  const span = coalesceNativeActivitySpan(parts, entries)!;
  assert.equal(span.segmentKey, '2026-12-31:activity_overnight:1438-1442');
  assert.deepEqual(span.entries, entries); assert.equal(span.entries[1]!.text, '');
  assert.equal(new Set(span.entries.map((entry) => entry.categoryId)).size, 2);
  span.entries[0]!.text = 'Mutated result'; assert.equal(entries[0]!.text, 'Note 0');
  const missingTitle = parts.map((part, index) => index ? { ...part, activityTitle: undefined } : part);
  const changedTitle = parts.map((part, index) => index ? { ...part, activityTitle: 'Different event' } : part);
  assert.equal(coalesceNativeActivitySpan(missingTitle, entries), null);
  assert.equal(coalesceNativeActivitySpan(changedTitle, entries), null);
  assert.equal(coalesceNativeActivitySpan(parts, entries.slice(1)), null);
  assert.equal(coalesceNativeActivitySpan(parts, [...entries, entries[0]!]), null);
  assert.equal(coalesceNativeActivitySpan(parts, entries.map((entry, index) => index === 4 ? { ...entry, minuteIndex: 4 } : entry)), null);
});

test('the sole exact native event may rekey to the same complete overnight span from either touched date without adopting extra bindings', () => {
  const { blockId, entries, parts } = night();
  const span = coalesceNativeActivitySpan(parts, entries)!;
  const binding = { segmentKey: `2026-12-31:${blockId}:100-104`, dateKey: '2026-12-31', blockId,
    calendarId: 'selected', eventId: 'original-event', updatedAt: 'known' };
  for (const processingDate of ['2026-12-31', '2027-01-01']) {
    const plan = planNativeBoundRetime({ blockId, selectedCalendarId: 'selected', hasAccountOwner: false,
      bindings: [binding], segments: [span], processingDate });
    if (plan.kind !== 'retime') throw Error(`Expected one exact retime, received ${plan.kind}`);
    assert.equal(plan.kind, 'retime');
    assert.equal(plan.afterBinding.eventId, 'original-event'); assert.equal(plan.afterBinding.segmentKey, span.segmentKey);
  }
  assert.equal(planNativeBoundRetime({ blockId, selectedCalendarId: 'selected', hasAccountOwner: false,
    bindings: [binding, { ...binding, eventId: 'other-event' }], segments: [span], processingDate: '2027-01-01' }).kind, 'deferred');
});
