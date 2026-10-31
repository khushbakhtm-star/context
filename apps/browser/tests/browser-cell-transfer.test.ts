import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { hashValue, validateBatch } from '../shared/sync/codec';
import { cellEventLabel, cellFormatKey, formatFromDocument } from '../shared/utils/cell-format';
import type { SyncDocument } from '../shared/sync/types';
import { minuteCellPresentation } from '../src/cell-presentation';
import { cellTransferDestination, cellTransferFingerprint, clipboardTransferFingerprint, contiguousMinuteSpan, formatCells, groupSelection, resetCellsSelection,
  transferCells, transferClipboardCells,
  type FormatCoordinate } from '../src/formatting';
import { editCells, emptyLedger, getMinute, mergeLedger, minuteKey, undoEdit, validateState } from '../src/ledger';

const day = '2026-10-30';
const revision = (counter: number, wall = 1000) => `${String(wall).padStart(16, '0')}:${String(counter).padStart(8, '0')}:phone_actor`;
const coord = (minute: number, date = day): FormatCoordinate => ({ day: date, minute });
const docAt = (state: ReturnType<typeof source>, point: FormatCoordinate) => getMinute(state, point.day, point.minute);
const formatAt = (state: ReturnType<typeof source>, point: FormatCoordinate) => state.documents.find((doc) => doc.key === cellFormatKey(point.day, point.minute));
function source(points = contiguousMinuteSpan(coord(600), coord(604)), blockId = 'activity_source', linked = false) {
  const documents: SyncDocument[] = points.flatMap((point, index) => [{
    key: minuteKey(point.day, point.minute), revision: revision(index), value: { id: `phone_${index}`,
      dateKey: point.day, minuteIndex: point.minute, text: ['First note', '', 'Third note', 'Fourth note', 'Last note'][index % 5]!,
      categoryId: 'prayer', blockId, source: 'imported', createdAt: 'original', updatedAt: 'original', opaqueMinute: { kept: true } },
  }, { key: cellFormatKey(point.day, point.minute), revision: revision(100 + index), value: { kind: 'minuteFormat',
    opaqueEnvelope: { kept: true }, format: { italic: true, underline: true, textColor: '#FFFFFF',
      futureFormat: { kept: true }, [blockId.startsWith('activity_') ? 'activityGroup' : 'calendarEvent']: { id: blockId, title: 'Study' } } },
  }]);
  if (linked) documents.push({ key: 'projection:approved_source', revision: revision(200), value: { id: 'approved_source',
    accountId: 'google:person', calendarId: 'personal', blockId, eventId: 'original_google_event', sourceEventId: 'original_google_event',
    dateKey: points[0]!.day, startMinute: points[0]!.minute, endDateKey: points.at(-1)!.day, endMinute: points.at(-1)!.minute,
    state: 'synced', baseLocalHash: 'original_hash', originalStart: '2026-10-30T10:00:00.000Z', opaqueOwnership: 'kept' } });
  return mergeLedger(emptyLedger('browser_actor'), documents);
}
const cells = (start: number, end = start, date = day) => contiguousMinuteSpan(coord(start, date), coord(end, date));

test('inclusive chronological grouping spans midnight/year/leap boundaries without interpreting a rectangle as an event', () => {
  const points = contiguousMinuteSpan(coord(1438, '2026-12-31'), coord(1, '2027-01-01'));
  assert.deepEqual(points, [coord(1438, '2026-12-31'), coord(1439, '2026-12-31'), coord(0, '2027-01-01'), coord(1, '2027-01-01')]);
  const initial = editCells(emptyLedger('browser_actor'), [{ ...points[0]!, text: 'Before midnight' }, { ...points[2]!, text: 'After midnight' }], 1000).state;
  const grouped = groupSelection(initial, [...points].reverse(), { title: 'Overnight activity' }, [], 2000);
  const entries = points.map((point) => docAt(grouped.state, point)!.value!);
  assert.equal(new Set(entries.map((entry) => entry.blockId)).size, 1);
  assert.deepEqual(entries.map((entry) => entry.text), ['Before midnight', '', 'After midnight', '']);
  const docs = new Map(grouped.state.documents.map((doc) => [doc.key, doc]));
  assert.equal(minuteCellPresentation(docs, '2026-12-31', 1439, () => undefined).last, false);
  assert.equal(minuteCellPresentation(docs, '2027-01-01', 0, () => undefined).first, false);
  assert.equal(minuteCellPresentation(docs, '2027-01-01', 1, () => undefined).last, true);
  assert.equal(contiguousMinuteSpan(coord(1439, '2028-02-28'), coord(0, '2028-02-29')).length, 2);
  assert.equal(contiguousMinuteSpan(coord(100), coord(99, '2026-10-31')).length, 1440);
  assert.throws(() => contiguousMinuteSpan(coord(100), coord(100, '2026-10-31')), /24 hours/);
  assert.throws(() => contiguousMinuteSpan(coord(600), coord(599)), /chronological/);
  assert.throws(() => contiguousMinuteSpan(coord(0, '2026-02-30'), coord(1, '2026-02-30')), /identifier/);
  assert.throws(() => groupSelection(initial, [coord(600), coord(600, '2026-10-31')], { title: 'Rectangle' }, [], 2000), /consecutive/);
});

test('a complete overnight local activity moves as full cells and retains the exact phone group/translation protocol', () => {
  const points = contiguousMinuteSpan(coord(1438), coord(2, '2026-10-31'));
  const initial = source(points); const snapshot = structuredClone(initial);
  const destination = coord(1438, '2026-11-03');
  const fingerprint = cellTransferFingerprint(initial, points, destination);
  const moved = transferCells(initial, points, destination, { expectedFingerprint: fingerprint }, 2000);
  assert.deepEqual(moved.destinationCoords, contiguousMinuteSpan(destination, coord(2, '2026-11-04')));
  for (let index = 0; index < points.length; index++) {
    const value = docAt(moved.state, moved.destinationCoords[index]!)!.value!;
    const old = docAt(initial, points[index]!)!.value!;
    assert.deepEqual(value, { ...old, dateKey: moved.destinationCoords[index]!.day,
      minuteIndex: moved.destinationCoords[index]!.minute, updatedAt: new Date(2000).toISOString() });
    assert.deepEqual(formatAt(moved.state, moved.destinationCoords[index]!)!.value, formatAt(initial, points[index]!)!.value);
    assert.equal(docAt(moved.state, points[index]!)!.value, null);
    assert.equal(formatAt(moved.state, points[index]!)!.value, null);
  }
  assert.equal(moved.state.documents.some((doc) => doc.key.startsWith('projection:')), false);
  validateState(moved.state);
  for (let offset = 0; offset < moved.state.documents.length; offset += 500) validateBatch({ version: 1, id: 'actual_phone_shape', documents: moved.state.documents.slice(offset, offset + 500) });
  const undone = undoEdit(moved.state, moved.undo, 3000);
  for (const document of initial.documents) assert.deepEqual(undone.documents.find((doc) => doc.key === document.key)!.value, document.value);
  assert.deepEqual(initial, snapshot);
});

test('optional monorepo interop: current phone helpers recognize the unchanged overnight group shape', {
  skip: !existsSync(new URL('../../mobile/src/utils/activity-translation.ts', import.meta.url)),
}, async () => {
  const { coalesceNativeActivitySpan, matchActivityTranslation } = await import('../../mobile/src/utils/activity-translation');
  const points = contiguousMinuteSpan(coord(1438), coord(2, '2026-10-31'));
  const moved = transferCells(source(points), points, coord(1438, '2026-11-03'), {}, 2000);
  const mapping = matchActivityTranslation([{ key: 'previous', dateKey: day, startMinute: 1438, endDateKey: '2026-10-31', endMinute: 2 }],
    [{ key: 'translated', dateKey: '2026-11-03', startMinute: 1438, endDateKey: '2026-11-04', endMinute: 2 }]);
  assert.equal(mapping!.shiftMinutes, 4 * 1440);
  const members = moved.destinationCoords.map((point) => docAt(moved.state, point)!.value!) as never[];
  const parts = [...new Set(moved.destinationCoords.map((point) => point.day))].map((date) => {
    const local = members.filter((member) => (member as { dateKey: string }).dateKey === date) as unknown as { minuteIndex: number }[];
    return { blockId: 'activity_source', activityTitle: 'Study', dateKey: date, startMinute: local[0]!.minuteIndex,
      endMinute: local.at(-1)!.minuteIndex, entries: local };
  });
  assert.equal(coalesceNativeActivitySpan(parts as never, members)!.entries.length, 5);
});

test('complete local borders retain activity identity while partial moves split the remaining border and detach the moved part', () => {
  const initial = source(cells(600, 604), 'activity_source');
  const complete = transferCells(initial, cells(600, 604), coord(800), {}, 2000);
  assert.equal(docAt(complete.state, coord(800))!.value!.blockId, 'activity_source');
  assert.equal(formatFromDocument(formatAt(complete.state, coord(800))!.value).activityGroup!.id, 'activity_source');
  const partial = transferCells(initial, cells(601, 602), coord(900), {}, 2000);
  assert.equal(docAt(partial.state, coord(600))!.value!.blockId, 'activity_source');
  const tailId = String(docAt(partial.state, coord(603))!.value!.blockId);
  const movedId = String(docAt(partial.state, coord(900))!.value!.blockId);
  assert.notEqual(tailId, 'activity_source'); assert.notEqual(movedId, 'activity_source'); assert.notEqual(movedId, tailId);
  assert.equal(docAt(partial.state, coord(604))!.value!.blockId, tailId);
  assert.equal(docAt(partial.state, coord(901))!.value!.blockId, movedId);
  assert.deepEqual([docAt(partial.state, coord(900))!.value!.text, docAt(partial.state, coord(901))!.value!.text], ['', 'Third note']);
  const presentation = new Map(partial.state.documents.map((doc) => [doc.key, doc]));
  for (const minute of [600, 603, 900]) assert.equal(minuteCellPresentation(presentation, day, minute, () => undefined).first, true);
  assert.equal(minuteCellPresentation(presentation, day, 600, () => undefined).last, true);
  assert.equal(cellEventLabel(formatFromDocument(formatAt(partial.state, coord(900))!.value), movedId)!.title, 'Study');
  assert.deepEqual(partial.state.documents.find((doc) => doc.key.startsWith('projection:')), initial.documents.find((doc) => doc.key.startsWith('projection:')));
  assert.equal(docAt(partial.state, coord(900))!.value!.source, 'manual');
});

test('copies receive fresh minute/activity identities and preserve the original source, words and opaque formatting', () => {
  const initial = source(cells(600, 604), 'source_original', true); const copied = transferCells(initial, cells(600, 604), coord(900), { copy: true }, 2000);
  const newId = String(docAt(copied.state, coord(900))!.value!.blockId);
  assert.notEqual(newId, 'source_original');
  for (let index = 0; index < 5; index++) {
    assert.deepEqual(docAt(copied.state, coord(600 + index)), docAt(initial, coord(600 + index)));
    const copy = docAt(copied.state, coord(900 + index))!.value!;
    assert.notEqual(copy.id, docAt(initial, coord(600 + index))!.value!.id);
    assert.equal(copy.blockId, newId); assert.equal(copy.source, 'manual');
    assert.equal(copy.text, docAt(initial, coord(600 + index))!.value!.text);
    assert.deepEqual(copy.opaqueMinute, { kept: true });
    const format = formatAt(copied.state, coord(900 + index))!.value!;
    assert.deepEqual(format.opaqueEnvelope, { kept: true });
    assert.deepEqual((format.format as Record<string, unknown>).futureFormat, { kept: true });
    assert.equal(formatFromDocument(format).activityGroup!.id, newId);
  }
  assert.deepEqual(copied.state.documents.filter((doc) => doc.key.startsWith('projection:')), initial.documents.filter((doc) => doc.key.startsWith('projection:')));
  assert.throws(() => transferCells(initial, cells(600, 604), coord(601), { copy: true }, 2000), /destination contains/);
});

test('overlapping moves read original cells once and dragging a non-anchor cell keeps a uniform civil offset', () => {
  const initial = source(cells(600, 604));
  for (const destination of [coord(601), coord(599)]) {
    const moved = transferCells(initial, cells(600, 604), destination, {}, 2000);
    assert.deepEqual(moved.destinationCoords.map((point) => docAt(moved.state, point)!.value!.text),
      cells(600, 604).map((point) => docAt(initial, point)!.value!.text));
    assert.equal(new Set(moved.destinationCoords.map((point) => docAt(moved.state, point)!.value!.blockId)).size, 1);
    const vacated = destination.minute === 601 ? 600 : 604;
    assert.equal(docAt(moved.state, coord(vacated))!.value, null);
  }
  assert.deepEqual(cellTransferDestination(cells(600, 604), coord(602), coord(1439)), coord(1437));
  const rectangle = [coord(600), coord(601), coord(600, '2026-10-31'), coord(601, '2026-10-31')];
  const destination = cellTransferDestination(rectangle, coord(601, '2026-10-31'), coord(1, '2026-11-02'));
  assert.deepEqual(destination, coord(0, '2026-11-01'));
  assert.throws(() => cellTransferDestination(cells(600, 604), coord(700), coord(800)), /within/);
});

test('occupied destinations and unsupported coordinates fail atomically rather than overwrite any note or format', () => {
  for (const occupied of [
    { key: minuteKey(day, 900), revision: revision(300), value: { ...docAt(source(), coord(600))!.value!, minuteIndex: 900 } },
    { key: cellFormatKey(day, 900), revision: revision(300), value: { kind: 'minuteFormat', format: { bold: true } } },
  ]) {
    const initial = mergeLedger(source(), [occupied]); const before = hashValue(initial);
    assert.throws(() => transferCells(initial, cells(600, 604), coord(900), {}, 2000), /destination contains/);
    assert.equal(hashValue(initial), before);
  }
  const initial = source(); const before = hashValue(initial);
  assert.throws(() => transferCells(initial, [coord(600), coord(600)], coord(900)), /once/);
  assert.throws(() => transferCells(initial, cells(600, 604), coord(1439, '9999-12-31')), /beyond supported dates/);
  assert.throws(() => transferCells(initial, Array.from({ length: 10001 }, () => coord(600)), coord(900)), /10,000/);
  assert.equal(hashValue(initial), before);
});

test('queued drag snapshots detect newer source, remainder, blank destination, membership and projection changes', () => {
  const initial = source(); const sourcePoints = cells(601, 602); const destination = coord(900);
  const fingerprint = cellTransferFingerprint(initial, sourcePoints, destination);
  const sourceStamp = cellTransferFingerprint(initial, sourcePoints, sourcePoints[0]!);
  const variations: SyncDocument[] = [
    { ...docAt(initial, coord(601))!, revision: revision(1, 3000), value: { ...docAt(initial, coord(601))!.value!, text: 'New phone note' } },
    { ...formatAt(initial, coord(604))!, revision: revision(2, 3000), value: { kind: 'minuteFormat', format: { bold: true } } },
    { key: cellFormatKey(day, 900), revision: revision(3, 3000), value: { kind: 'minuteFormat', format: { underline: true } } },
    { key: minuteKey(day, 605), revision: revision(4, 3000), value: { ...docAt(initial, coord(604))!.value!, minuteIndex: 605 } },
    { key: 'projection:new_owner', revision: revision(5, 3000), value: { blockId: 'activity_source', eventId: 'a-new-owner' } },
  ];
  for (const document of variations) {
    const changed = mergeLedger(initial, [document]); const before = hashValue(changed);
    assert.throws(() => transferCells(changed, sourcePoints, destination, { expectedFingerprint: fingerprint }, 4000), /changed.*again/);
    assert.equal(hashValue(changed), before);
    if (document.key !== cellFormatKey(day, 900)) assert.notEqual(cellTransferFingerprint(changed, sourcePoints, sourcePoints[0]!), sourceStamp);
  }
});

test('Undo guards unchanged blank endpoints, outside membership, changed-and-restored notes and new calendar links', () => {
  const initial = source(cells(600, 601));
  const result = transferCells(initial, cells(600, 602), coord(900), {}, 2000);
  assert.equal(docAt(result.state, coord(902)), undefined, 'an unchanged blank target need not manufacture a tombstone');
  const destinationNew = editCells(result.state, [{ ...coord(902), text: 'New destination note' }], 3000).state;
  assert.throws(() => undoEdit(destinationNew, result.undo, 4000), /newer work/);
  const newSource = editCells(result.state, [{ ...coord(602), text: 'New source note' }], 3000).state;
  assert.throws(() => undoEdit(newSource, result.undo, 4000), /newer work/);
  const outside = mergeLedger(result.state, [{ key: minuteKey(day, 999), revision: revision(1, 3000),
    value: { ...docAt(result.state, coord(900))!.value!, minuteIndex: 999 } }]);
  assert.throws(() => undoEdit(outside, result.undo, 4000), /activity changed/);
  const projection = mergeLedger(result.state, [{ key: 'projection:later_owner', revision: revision(2, 3000),
    value: { blockId: 'activity_source', eventId: 'later_owner' } }]);
  assert.throws(() => undoEdit(projection, result.undo, 4000), /calendar link changed/);
  const changed = editCells(result.state, [{ ...coord(900), text: 'Temporary new note' }], 3000).state;
  const restored = editCells(changed, [{ ...coord(900), text: 'First note' }], 3100).state;
  assert.throws(() => undoEdit(restored, result.undo, 4000), /newer work/);
});

test('complete and partial provider-linked moves are blocked before any tombstones can escape in separate upload files', () => {
  const initial = source(cells(600, 604), 'source_original', true); const before = hashValue(initial);
  for (const selected of [cells(600, 604), cells(601, 602)]) {
    assert.throws(() => transferCells(initial, selected, coord(900), {}, 2000), /Move this linked calendar event on your phone/);
    assert.equal(hashValue(initial), before);
  }
  const unbordered = mergeLedger(initial, cells(600, 604).map((point, index) => ({ key: cellFormatKey(point.day, point.minute),
    revision: revision(index, 1500), value: null })));
  assert.throws(() => transferCells(unbordered, cells(600, 604), coord(900), {}, 2000), /linked calendar event on your phone/);
  const privateNativeLink = source(cells(600, 604), 'source_original');
  assert.throws(() => transferCells(privateNativeLink, cells(600, 604), coord(900), {}, 2000), /linked calendar event on your phone/,
    'calendarEvent labels protect links whose native binding is private to the phone');
  const projection = initial.documents.find((doc) => doc.key.startsWith('projection:'))!;
  const conflicted = mergeLedger(initial, [{ ...projection, revision: revision(50, 1500), value: { ...projection.value!, state: 'conflict' } }]);
  assert.throws(() => transferCells(conflicted, cells(600, 604), coord(900), {}, 2000), /linked calendar event on your phone/);
  const copy = transferCells(conflicted, cells(600, 604), coord(900), { copy: true }, 2000);
  assert.notEqual(docAt(copy.state, coord(900))!.value!.blockId, 'source_original');
});

test('the full 10,000-cell move bound includes both endpoints and formats in one validated reversible command', () => {
  const points = Array.from({ length: 10_000 }, (_, index) => {
    const date = new Date(Date.parse(`${day}T00:00:00Z`) + Math.floor(index / 1440) * 86400000);
    return coord(index % 1440, date.toISOString().slice(0, 10));
  });
  const notes = editCells(emptyLedger('browser_actor'), points.map((point, index) => ({ ...point, text: `Synthetic ${index}` })), 1000).state;
  const initial = formatCells(notes, points, { bold: true }, [], 1500).state;
  const moved = transferCells(initial, points, coord(0, '2026-11-20'), {}, 2000);
  assert.equal(moved.undo.after.length, 40_000);
  assert.equal(moved.destinationCoords.length, 10_000);
  assert.equal(docAt(moved.state, moved.destinationCoords.at(-1)!)!.value!.text, 'Synthetic 9999');
  validateState(moved.state);
  const undone = undoEdit(moved.state, moved.undo, 3000);
  assert.equal(docAt(undone, points[0]!)!.value!.text, 'Synthetic 0');
  assert.equal(docAt(undone, points.at(-1)!)!.value!.text, 'Synthetic 9999');
  assert.equal(formatFromDocument(formatAt(undone, points.at(-1)!)!.value).bold, true);
  assert.equal(docAt(undone, moved.destinationCoords.at(-1)!)!.value, null);
  validateState(undone);
});

test('one whole copied source cell fills a destination rectangle with detached identities and one guarded Undo', () => {
  const initial = source(cells(600, 604), 'source_original', true);
  const originalPoint = coord(602); const sourcePoints = [originalPoint];
  const destinations = [coord(900), coord(901), coord(900, '2026-10-31'), coord(901, '2026-10-31')];
  const sourceFingerprint = cellTransferFingerprint(initial, sourcePoints, originalPoint, { copy: false });
  const expectedFingerprint = clipboardTransferFingerprint(initial, sourcePoints, destinations, { copy: true });
  const result = transferClipboardCells(initial, sourcePoints, destinations, { copy: true,
    expectedSourceFingerprint: sourceFingerprint, expectedFingerprint }, 2000);
  assert.deepEqual(result.destinationCoords, destinations);
  const copies = destinations.map((point) => docAt(result.state, point)!.value!);
  assert.equal(new Set(copies.map((entry) => entry.id)).size, 4);
  assert.equal(new Set(copies.map((entry) => entry.blockId)).size, 4);
  assert.ok(copies.every((entry) => entry.text === 'Third note' && entry.categoryId === 'prayer' && entry.source === 'manual' && entry.blockId !== 'source_original'));
  for (const point of destinations) {
    const format = formatAt(result.state, point)!.value!;
    assert.deepEqual(format.opaqueEnvelope, { kept: true });
    assert.equal(formatFromDocument(format).activityGroup!.title, 'Study');
    assert.equal(formatFromDocument(format).activityGroup!.id, docAt(result.state, point)!.value!.blockId);
  }
  for (const document of initial.documents) assert.deepEqual(result.state.documents.find((doc) => doc.key === document.key), document);
  assert.equal(result.undo.after.length, 8);
  const undone = undoEdit(result.state, result.undo, 3000);
  for (const point of destinations) {
    assert.equal(docAt(undone, point)!.value, null); assert.equal(formatAt(undone, point)!.value, null);
  }
  const changedSource = editCells(result.state, [{ ...coord(604), text: 'New outside group member note' }], 3000).state;
  assert.throws(() => undoEdit(changedSource, result.undo, 4000), /newer work|activity changed/);
  const changedDestination = editCells(result.state, [{ ...destinations[3]!, text: 'New pasted note' }], 3000).state;
  assert.throws(() => undoEdit(changedDestination, result.undo, 4000), /newer work/);
});

test('clipboard aggregate validates every destination/source snapshot atomically and leaves the copied source in its own fill range intact', () => {
  const initial = source(cells(600, 604), 'source_original', true); const sourcePoints = [coord(600)];
  const destinations = [coord(600), coord(900), coord(901)];
  const result = transferClipboardCells(initial, sourcePoints, destinations, { copy: true }, 2000);
  assert.deepEqual(docAt(result.state, coord(600)), docAt(initial, coord(600)));
  assert.equal(result.undo.after.length, 4);
  const occupied = editCells(initial, [{ ...coord(901), text: 'Keep destination' }], 1500).state;
  const before = hashValue(occupied);
  assert.throws(() => transferClipboardCells(occupied, sourcePoints, destinations, { copy: true }, 2000), /destination contains/);
  assert.equal(hashValue(occupied), before);
  const sourceStamp = cellTransferFingerprint(initial, sourcePoints, coord(600), { copy: false });
  const changedSource = editCells(initial, [{ ...coord(600), text: 'Changed after copy' }], 1500).state;
  assert.throws(() => transferClipboardCells(changedSource, sourcePoints, destinations, { copy: true, expectedSourceFingerprint: sourceStamp }, 2000), /cut cells changed/);
  const destinationStamp = clipboardTransferFingerprint(initial, sourcePoints, destinations, { copy: true });
  assert.throws(() => transferClipboardCells(occupied, sourcePoints, destinations, { copy: true, expectedFingerprint: destinationStamp }, 2000), /changed.*again/);
  assert.throws(() => transferClipboardCells(initial, sourcePoints, [coord(900), coord(900)], { copy: true }, 2000), /once/);
});

test('clipboard Cut and multi-cell Copy translate once, while format-only single-cell replication never invents minute records', () => {
  const initial = source(); const destinations = [coord(900), coord(901), coord(902)];
  const cut = transferClipboardCells(initial, cells(600, 601), destinations, { copy: false }, 2000);
  assert.deepEqual(cut.destinationCoords, cells(900, 901));
  assert.equal(docAt(cut.state, coord(600))!.value, null);
  const copy = transferClipboardCells(initial, cells(600, 601), destinations, { copy: true }, 2000);
  assert.deepEqual(copy.destinationCoords, cells(900, 901));
  assert.deepEqual(docAt(copy.state, coord(600)), docAt(initial, coord(600)));
  const linked = source(cells(600, 604), 'source_original', true);
  assert.throws(() => transferClipboardCells(linked, [coord(600)], destinations, { copy: false }, 2000), /linked calendar event on your phone/);
  const style = formatCells(emptyLedger('browser_actor'), [coord(600)], { bold: true, textColor: '#123456' }, [], 1000).state;
  const styled = transferClipboardCells(style, [coord(600)], destinations, { copy: true }, 2000);
  assert.equal(styled.state.documents.some((doc) => doc.key.startsWith('minute:') && doc.value), false);
  for (const point of destinations) assert.deepEqual(formatAt(styled.state, point)!.value, formatAt(style, coord(600))!.value);
});

test('Reset destinations accept a whole-cell move or repeated Copy and Undo restores their exact bare marker', () => {
  const reset = resetCellsSelection(source(), cells(900, 901), 1500).state;
  const marker = { kind: 'minuteFormat', format: { noFill: true } };
  for (const result of [transferCells(reset, cells(600, 601), coord(900), {}, 2000),
    transferClipboardCells(reset, [coord(600)], cells(900, 901), { copy: true }, 2000)]) {
    assert.equal(docAt(result.state, coord(900))!.value!.text, 'First note');
    assert.equal(formatFromDocument(formatAt(result.state, coord(900))!.value).italic, true);
    const undone = undoEdit(result.state, result.undo, 3000);
    for (const point of cells(900, 901)) {
      assert.equal(docAt(undone, point)!.value, null);
      assert.deepEqual(formatAt(undone, point)!.value, marker);
    }
  }
  const sourceStamp = cellTransferFingerprint(reset, [coord(600)], coord(600), { copy: false });
  const destinationStamp = clipboardTransferFingerprint(reset, [coord(600)], cells(900, 901), { copy: true });
  const newerMarker = mergeLedger(reset, [{ ...formatAt(reset, coord(901))!, revision: revision(1, 1900) }]);
  assert.throws(() => transferClipboardCells(newerMarker, [coord(600)], cells(900, 901), { copy: true, expectedFingerprint: destinationStamp }, 2000), /changed.*again/);
  const newerSource = editCells(reset, [{ ...coord(600), text: 'New source after Reset' }], 1900).state;
  assert.throws(() => transferClipboardCells(newerSource, [coord(600)], cells(900, 901), { copy: true, expectedSourceFingerprint: sourceStamp }, 2000), /cut cells changed/);
  for (const value of [
    { ...marker, opaqueEnvelope: 'keep' },
    { kind: 'minuteFormat', format: { noFill: true, bold: true } },
    { kind: 'minuteFormat', format: { noFill: true, futureStyle: {} } },
  ]) {
    const occupied = mergeLedger(reset, [{ key: cellFormatKey(day, 901), revision: revision(2, 1900), value }]);
    assert.throws(() => transferCells(occupied, cells(600, 601), coord(900), {}, 2000), /destination contains/);
    assert.throws(() => transferClipboardCells(occupied, [coord(600)], cells(900, 901), { copy: true }, 2000), /destination contains/);
  }
});
