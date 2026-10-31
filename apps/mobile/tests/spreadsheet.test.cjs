const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const plain = (value) => JSON.parse(JSON.stringify(value));
const day = '2026-10-25';
const { setImmediate } = require('node:timers/promises');

test('an overnight pencil fill creates one border with independent notes, styles and one atomic Undo across both dates', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  const next = '2026-10-26';
  await save(api, 100, 'Clipboard'); const clipboard = plain(await sheet.copyMinuteRange(range(100)));
  await save(api, 1439, 'Keep this exact note', 'family');
  await sheet.applyCellFormat(range(1439), { bold: true, underline: true, textColor: '#123456' });
  await api.saveMinuteEntry({ dateKey: next, minuteIndex: 1, text: 'Morning note', categoryId: 'work' });
  const span = { startDateKey: day, startMinute: 1438, endDateKey: next, endMinute: 3 };
  const input = { event: { title: 'Sleep', categoryId: 'physiological' } };
  const preview = await sheet.prepareMinuteSpanFill(span, input);
  assert.equal(preview.cellCount, 5); assert.equal(preview.occupiedCount, 2);
  assert.deepEqual(plain(preview.ranges), [range(1438, 1439), range(0, 2, next)]);
  await sheet.fillMinuteSpan(span, input, { previewToken: preview.token });
  const members = [...await api.getDayEntries(day), ...await api.getDayEntries(next)].filter((entry) => entry.minuteIndex !== 100);
  assert.equal(members.length, 5); const blockId = members[0].blockId;
  assert.ok(blockId.startsWith('activity_')); assert.ok(members.every((entry) => entry.blockId === blockId && entry.categoryId === 'physiological'));
  assert.deepEqual(members.map((entry) => entry.text), ['', 'Keep this exact note', '', 'Morning note', '']);
  const format = (await sheet.getDayCellFormats(day)).get(1439);
  assert.deepEqual(plain(format), { bold: true, underline: true, textColor: '#123456', activityGroup: { id: blockId, title: 'Sleep' } });
  assert.deepEqual(plain((await sheet.getDayCellFormats(next)).get(0).activityGroup), { id: blockId, title: 'Sleep' });
  assert.deepEqual(plain(sheet.getSpreadsheetClipboard()), clipboard);
  await sheet.undoSpreadsheetEdit();
  assert.equal(await api.getMinuteEntry(day, 1438), null); assert.equal(await api.getMinuteEntry(next, 0), null);
  assert.equal((await api.getMinuteEntry(day, 1439)).text, 'Keep this exact note');
  assert.equal((await api.getMinuteEntry(next, 1)).categoryId, 'work');
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(1439)), { bold: true, underline: true, textColor: '#123456' });
  await sheet.redoSpreadsheetEdit(); assert.equal((await api.getEntriesForBlock(blockId)).length, 5);
});

test('overnight text fills preserve complete text, fills, formats and borders without creating an implicit event', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase(); const next = '2026-10-26';
  await sheet.groupMinuteRange(range(1439), { title: 'Existing event', categoryId: 'family' });
  const original = await api.getMinuteEntry(day, 1439);
  await sheet.applyCellFormat(range(0, 0, next), { italic: true });
  const span = { startDateKey: day, startMinute: 1439, endDateKey: next, endMinute: 2 };
  const text = '  Full text\nUnicode café • 💤\r\nlast line  ';
  let input = { text }; let preview = await sheet.prepareMinuteSpanFill(span, input);
  await sheet.fillMinuteSpan(span, input, { previewToken: preview.token });
  for (const [dateKey, minuteIndex] of [[day, 1439], [next, 0], [next, 1]]) assert.equal((await api.getMinuteEntry(dateKey, minuteIndex)).text, text);
  assert.equal((await api.getMinuteEntry(day, 1439)).blockId, original.blockId);
  assert.equal((await api.getMinuteEntry(day, 1439)).categoryId, 'family');
  assert.deepEqual(plain((await sheet.getDayCellFormats(next)).get(0)), { italic: true });
  assert.equal((await sheet.getDayCellFormats(next)).get(1), undefined);
  assert.ok(!(await api.getMinuteEntry(next, 0)).blockId.startsWith('activity_'));
  input = { text: '' }; preview = await sheet.prepareMinuteSpanFill(span, input);
  await sheet.fillMinuteSpan(span, input, { previewToken: preview.token });
  assert.equal((await api.getMinuteEntry(day, 1439)).text, '');
  assert.equal((await api.getMinuteEntry(day, 1439)).blockId, original.blockId);
  await sheet.undoSpreadsheetEdit(); assert.equal((await api.getMinuteEntry(next, 1)).text, text);
});

test('explicit pencil resizing retains the exact source border and keeps distinct outside notes private without the old event fill', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase(); const next = '2026-10-26';
  await save(api, 1438, 'Before sleep', 'family'); await save(api, 1439, 'Lights off', 'family');
  await sheet.groupMinuteRange(range(1438, 1439), { title: 'Old name', categoryId: 'family' });
  await sheet.applyCellFormat(range(1438), { bold: true });
  const blockId = (await api.getMinuteEntry(day, 1438)).blockId;
  const span = { startDateKey: next, startMinute: 0, endDateKey: next, endMinute: 3 };
  const input = { event: { blockId, title: 'Sleep', categoryId: 'physiological' } };
  const preview = await sheet.prepareMinuteSpanFill(span, input); assert.equal(preview.occupiedCount, 0);
  await sheet.fillMinuteSpan(span, input, { previewToken: preview.token });
  assert.deepEqual((await api.getEntriesForBlock(blockId)).map((entry) => [entry.dateKey, entry.minuteIndex]), [[next, 0], [next, 1], [next, 2]]);
  assert.equal((await api.getMinuteEntry(day, 1438)).text, 'Before sleep');
  assert.equal((await api.getMinuteEntry(day, 1438)).categoryId, 'unaccounted');
  assert.ok((await api.getMinuteEntry(day, 1438)).blockId.startsWith('sheet_'));
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(1438)), { bold: true, noFill: true });
  assert.deepEqual(plain(await sheet.getDayActivityGroups(day)), []);
  assert.equal((await sheet.getDayActivityGroups(next))[0].blockId, blockId);
  await sheet.undoSpreadsheetEdit(); assert.equal((await api.getMinuteEntry(day, 1438)).blockId, blockId);
  assert.equal(await api.getMinuteEntry(next, 0), null);
  await sheet.redoSpreadsheetEdit(); assert.equal((await api.getEntriesForBlock(blockId)).length, 3);
});

test('correcting an overnight uniform Sleep fill replaces both old dates with one same-day border and one Undo', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  const startDay = '2026-10-29', endDay = '2026-10-30';
  await api.saveMinuteEntry({ dateKey: startDay, minuteIndex: 600, text: 'Outside before the fill', categoryId: 'work' });
  await api.saveMinuteEntry({ dateKey: endDay, minuteIndex: 600, text: 'Outside after the fill', categoryId: 'family' });
  const wrong = { startDateKey: startDay, startMinute: 724, endDateKey: endDay, endMinute: 444 };
  let input = { text: 'Sleep', event: { title: 'Sleep', categoryId: 'sleep' } };
  let preview = await sheet.prepareMinuteSpanFill(wrong, input);
  const created = await sheet.fillMinuteSpan(wrong, input, { previewToken: preview.token });
  const blockId = created.blockId; assert.ok(blockId);
  assert.deepEqual(plain(created.affectedDates), [startDay, endDay]);
  const oldCount = (await api.getEntriesForBlock(blockId)).length;
  assert.equal(oldCount, 1160);
  // A single Undo must restore the complete old range, including these styles.
  await sheet.applyCellFormat(range(725, 725, startDay), { italic: true, textColor: '#123456' });
  const corrected = { startDateKey: startDay, startMinute: 0, endDateKey: startDay, endMinute: 444 };
  input = { text: 'Sleep', event: { blockId, title: 'Sleep', categoryId: 'sleep' } };
  preview = await sheet.prepareMinuteSpanFill(corrected, input);
  const applied = await sheet.fillMinuteSpan(corrected, input, { previewToken: preview.token });
  assert.equal(applied.blockId, blockId); assert.deepEqual(new Set(applied.affectedDates), new Set([startDay, endDay]));
  const members = await api.getEntriesForBlock(blockId);
  assert.equal(members.length, 444);
  assert.ok(members.every((entry) => entry.dateKey === startDay && entry.minuteIndex < 444 && entry.text === 'Sleep' && entry.categoryId === 'sleep'));
  for (const dateKey of [startDay, endDay]) {
    const oldCells = await api.getSpreadsheetCells(range(dateKey === startDay ? 724 : 0, dateKey === startDay ? 1439 : 443, dateKey));
    assert.ok(oldCells.every((cell) => cell.entry === null && Object.keys(cell.format).length === 0), 'removed uniform fill is a default cell');
  }
  assert.equal(await api.getMinuteEntry(startDay, 444), null, 'the calendar endpoint starts the next minute');
  assert.equal((await api.getMinuteEntry(startDay, 600)).text, 'Outside before the fill');
  assert.equal((await api.getMinuteEntry(endDay, 600)).text, 'Outside after the fill');
  assert.deepEqual(plain(await sheet.getDayActivityGroups(endDay)), []);
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getEntriesForBlock(blockId)).length, oldCount);
  assert.equal(await api.getMinuteEntry(startDay, 0), null);
  assert.deepEqual(plain((await sheet.getDayCellFormats(startDay)).get(725)), { italic: true, textColor: '#123456', activityGroup: { id: blockId, title: 'Sleep' } });
  await sheet.redoSpreadsheetEdit();
  assert.equal((await api.getEntriesForBlock(blockId)).length, 444);
  assert.equal(await api.getMinuteEntry(endDay, 0), null);
});

test('extending a uniform event fills each newly included minute while preserving its exact block identity', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  let span = { startDateKey: day, startMinute: 1200, endDateKey: day, endMinute: 1256 };
  let input = { text: 'Gaming', event: { title: 'Gaming', categoryId: 'study' } };
  let preview = await sheet.prepareMinuteSpanFill(span, input);
  const { blockId } = await sheet.fillMinuteSpan(span, input, { previewToken: preview.token });
  assert.equal(await api.getMinuteEntry(day, 1256), null);
  span = { ...span, endMinute: 1257 }; input = { ...input, event: { ...input.event, blockId } };
  preview = await sheet.prepareMinuteSpanFill(span, input);
  const applied = await sheet.fillMinuteSpan(span, input, { previewToken: preview.token });
  assert.equal(applied.blockId, blockId);
  const added = await api.getMinuteEntry(day, 1256);
  assert.equal(added.text, 'Gaming'); assert.equal(added.categoryId, 'study'); assert.equal(added.blockId, blockId);
  assert.equal((await api.getEntriesForBlock(blockId)).length, 57);
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(1256).activityGroup), { id: blockId, title: 'Gaming' });
  assert.equal(await api.getMinuteEntry(day, 1257), null, 'the next activity begins at the calendar endpoint');
  await sheet.undoSpreadsheetEdit(); assert.equal(await api.getMinuteEntry(day, 1256), null);
  await sheet.redoSpreadsheetEdit(); assert.equal((await api.getMinuteEntry(day, 1256)).text, 'Gaming');
});

test('overnight preview guards all destination cells and the complete old border including disjoint members and ABA changes', async (t) => {
  for (const changed of ['destination', 'old-format', 'old-membership', 'input', 'token']) {
    const { api, sheet } = harness(t); await api.initializeDatabase(); const next = '2026-10-26';
    await sheet.groupMinuteRange(range(600, 601), { title: 'Old event', categoryId: 'family' });
    const blockId = (await api.getMinuteEntry(day, 600)).blockId;
    const span = { startDateKey: day, startMinute: 1439, endDateKey: next, endMinute: 2 };
    const input = { text: 'Sleep', event: { blockId, title: 'Sleep', categoryId: 'physiological' } };
    const preview = await sheet.prepareMinuteSpanFill(span, input);
    if (changed === 'destination') { await api.saveMinuteEntry({ dateKey: next, minuteIndex: 1, text: 'Temporary', categoryId: 'work' }); await api.deleteMinuteEntry(next, 1); }
    if (changed === 'old-format') { await sheet.applyCellFormat(range(600), { bold: true }); await sheet.applyCellFormat(range(600), { bold: false }); }
    if (changed === 'old-membership') {
      const before = await api.getSpreadsheetCells(range(602));
      await api.applySpreadsheetTransaction([{ day, expected: before, target: [{ ...before[0],
        entry: { text: 'Late member', categoryId: 'family', blockId },
        format: { activityGroup: { id: blockId, title: 'Old event' } } }] }], { textChanged: true, formatChanged: true });
    }
    if (changed === 'token') await sheet.prepareMinuteSpanFill(span, input);
    await assert.rejects(sheet.fillMinuteSpan(span, changed === 'input' ? { ...input, text: 'Changed input' } : input, { previewToken: preview.token }), /changed|review/i, changed);
    assert.equal(await api.getMinuteEntry(day, 1439), null); assert.equal(await api.getMinuteEntry(next, 0), null);
    assert.equal((await api.getMinuteEntry(day, 600)).blockId, blockId);
  }
});

test('pencil fill cannot consolidate disjoint borders sharing an ID and does not mutate notes, history or queued calendar work', async (t) => {
  for (const explicit of [false, true]) {
    const { api, sheet, inline, linkCalls } = harness(t); await api.initializeDatabase();
    await sheet.groupMinuteRange(range(600), { title: 'First border', categoryId: 'family' });
    const blockId = (await api.getMinuteEntry(day, 600)).blockId;
    const before = await api.getSpreadsheetCells(range(602));
    await api.applySpreadsheetTransaction([{ day, expected: before, target: [{ ...before[0],
      entry: { text: 'Keep independent minute', categoryId: 'family', blockId },
      format: { activityGroup: { id: blockId, title: 'First border' } } }] }], { textChanged: true, formatChanged: true });
    await inline.retryInlineMinuteLinks();
    const documents = plain(await api.getSyncDocuments('')); const pending = plain(await api.getPendingInlineMinuteLinks());
    const history = plain(sheet.spreadsheetEditor.snapshot()); const entries = plain(await api.getDayEntries(day));
    const called = linkCalls.length;
    const span = { startDateKey: day, startMinute: 600, endDateKey: day, endMinute: 604 };
    await assert.rejects(sheet.prepareMinuteSpanFill(span, { text: 'No', event: { title: 'Merged', categoryId: 'family',
      ...(explicit ? { blockId } : {}) } }), /ambiguous borders/);
    assert.deepEqual(plain(await api.getDayEntries(day)), entries); assert.deepEqual(plain(await api.getSyncDocuments('')), documents);
    assert.deepEqual(plain(await api.getPendingInlineMinuteLinks()), pending); assert.deepEqual(plain(sheet.spreadsheetEditor.snapshot()), history);
    assert.equal(linkCalls.length, called, 'a rejected preview does not invoke a calendar-link operation');
  }
});

test('an overnight transaction failure rolls back both dates and journals while a new preview can recover', async (t) => {
  const { api, sheet, sqlite, inline } = harness(t); await api.initializeDatabase(); const next = '2026-10-26';
  await save(api, 1439, 'Keep original'); await inline.retryInlineMinuteLinks();
  const span = { startDateKey: day, startMinute: 1439, endDateKey: next, endMinute: 2 };
  const input = { text: 'Sleep', event: { title: 'Sleep', categoryId: 'physiological' } };
  const preview = await sheet.prepareMinuteSpanFill(span, input);
  const documents = plain(await api.getSyncDocuments('')); const pending = plain(await api.getPendingInlineMinuteLinks());
  sqlite.exec(`CREATE TRIGGER reject_overnight_fill BEFORE INSERT ON ledger_documents
    WHEN NEW.key = 'category:minuteFormat:2026-10-26:1' BEGIN SELECT RAISE(ABORT, 'overnight failed'); END;`);
  await assert.rejects(sheet.fillMinuteSpan(span, input, { previewToken: preview.token }), /overnight failed/);
  assert.equal((await api.getMinuteEntry(day, 1439)).text, 'Keep original'); assert.equal(await api.getMinuteEntry(next, 0), null);
  assert.deepEqual(plain(await api.getSyncDocuments('')), documents); assert.deepEqual(plain(await api.getPendingInlineMinuteLinks()), pending);
  assert.equal(sheet.spreadsheetEditor.snapshot().busy, false);
  sqlite.exec('DROP TRIGGER reject_overnight_fill');
  const retry = await sheet.prepareMinuteSpanFill(span, input); await sheet.fillMinuteSpan(span, input, { previewToken: retry.token });
  assert.equal((await api.getMinuteEntry(next, 1)).text, 'Sleep');
});

test('blank unchanged span is a no-op and invalid oversized ranges or unknown event colors never write', async (t) => {
  const { api, sheet, inline } = harness(t); await api.initializeDatabase();
  activate(inline, 600, 'Untouched display baseline');
  const span = { startDateKey: day, startMinute: 600, endDateKey: day, endMinute: 602 };
  const preview = await sheet.prepareMinuteSpanFill(span, {}); await sheet.fillMinuteSpan(span, {}, { previewToken: preview.token });
  assert.equal(sheet.spreadsheetEditor.snapshot().canUndo, false); assert.equal((await api.getDayEntries(day)).length, 0);
  assert.equal(inline.inlineMinuteDrafts.get(day, 600).text, 'Untouched display baseline');
  await assert.rejects(sheet.prepareMinuteSpanFill(span, { event: { title: 'Sleep', categoryId: 'missing' } }), /color/);
  assert.throws(() => sheet.prepareMinuteSpanFill({ ...span, endDateKey: '2026-10-27' }, { text: 'No' }), /24 hours/);
  assert.equal((await api.getDayEntries(day)).length, 0);
});

test('dragging an independent selected range moves full cells across dates without touching clipboard and has one atomic Undo', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await save(api, 100, 'Clipboard stays'); const clipboard = await sheet.cutMinuteRange(range(100));
  await sheet.pasteExternalMinuteRange('  coffee Ã¢Ëœâ€¢  ', { dateKey: day, startMinute: 600 });
  await sheet.colorMinuteRange(range(600, 601), 'family');
  await sheet.applyCellFormat(range(600), { bold: true, underline: true, textColor: '#123456' });
  await sheet.applyCellFormat(range(602), { italic: true });
  const source = range(600, 602), target = { dateKey: '2026-10-26', startMinute: 700 };
  const formats = plain([...(await sheet.getDayCellFormats(day))]);
  const held = await sheet.prepareMinuteRangeMove(source, { dateKey: day, startMinute: 600 });
  const preview = await sheet.prepareMinuteRangeMove(source, target, { sourceToken: held.token });
  assert.equal((await api.getMinuteEntry(day, 600)).text, '  coffee Ã¢Ëœâ€¢  ');
  assert.equal(await api.getMinuteEntry(target.dateKey, 700), null);
  await sheet.moveMinuteRange(source, target, { previewToken: preview.token });
  for (const minute of [600, 601, 602]) assert.equal(await api.getMinuteEntry(day, minute), null);
  assert.equal((await api.getMinuteEntry(target.dateKey, 700)).text, '  coffee Ã¢Ëœâ€¢  ');
  assert.equal((await api.getMinuteEntry(target.dateKey, 701)).text, '');
  assert.equal((await api.getMinuteEntry(target.dateKey, 701)).categoryId, 'family');
  assert.equal(await api.getMinuteEntry(target.dateKey, 702), null, 'style-only blank stays unrecorded');
  const movedFormats = await sheet.getDayCellFormats(target.dateKey);
  assert.deepEqual(plain(movedFormats.get(700)), { bold: true, underline: true, textColor: '#123456' });
  assert.deepEqual(plain(movedFormats.get(702)), { italic: true });
  assert.deepEqual(plain(sheet.getSpreadsheetClipboard()), plain(clipboard));
  assert.equal((await api.getMinuteEntry(day, 100)).text, 'Clipboard stays');
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 600)).text, '  coffee Ã¢Ëœâ€¢  ');
  assert.equal((await api.getDayEntries(target.dateKey)).length, 0);
  assert.deepEqual(plain([...(await sheet.getDayCellFormats(day))]), formats);
  await sheet.redoSpreadsheetEdit(); assert.equal((await api.getMinuteEntry(target.dateKey, 701)).categoryId, 'family');
  assert.deepEqual(plain(sheet.getSpreadsheetClipboard()), plain(clipboard));
});

test('selected range drag uses an immutable snapshot for overlapping upward and downward destinations', async (t) => {
  for (const start of [599, 601]) {
    const { api, sheet } = harness(t); await api.initializeDatabase();
    for (const [offset, text] of ['A', 'B', 'C'].entries()) await save(api, 600 + offset, text);
    const source = range(600, 602), destination = { dateKey: day, startMinute: start };
    const preview = await sheet.prepareMinuteRangeMove(source, destination);
    assert.equal(preview.occupiedCount, 0, 'overlap with the same source needs no replacement prompt');
    await sheet.moveMinuteRange(source, destination, { previewToken: preview.token });
    assert.deepEqual((await api.getDayEntries(day)).map((entry) => [entry.minuteIndex, entry.text]),
      [[start, 'A'], [start + 1, 'B'], [start + 2, 'C']]);
    await sheet.undoSpreadsheetEdit();
    assert.deepEqual((await api.getDayEntries(day)).map((entry) => [entry.minuteIndex, entry.text]), [[600, 'A'], [601, 'B'], [602, 'C']]);
  }
});

test('partial-group dragging detaches moved notes and atomically splits the untouched and overwritten activity remainders', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  for (let minute = 600; minute <= 604; minute++) await save(api, minute, `Note ${minute}`);
  await sheet.groupMinuteRange(range(600, 604), { title: 'Coffee', categoryId: 'family' });
  await sheet.groupMinuteRange(range(700, 704), { title: 'Work', categoryId: 'work' });
  const original = (await api.getMinuteEntry(day, 600)).blockId;
  const destinationOriginal = (await api.getMinuteEntry(day, 700)).blockId;
  await sheet.applyCellFormat(range(602), { underline: true });
  const source = range(602), destination = { dateKey: day, startMinute: 702 };
  const preview = await sheet.prepareMinuteRangeMove(source, destination); assert.equal(preview.occupiedCount, 1);
  await sheet.moveMinuteRange(source, destination, { previewToken: preview.token });
  assert.equal(await api.getMinuteEntry(day, 602), null);
  assert.equal((await api.getMinuteEntry(day, 702)).text, 'Note 602');
  assert.equal((await api.getMinuteEntry(day, 702)).categoryId, 'family');
  assert.equal((await sheet.getDayCellFormats(day)).get(702).activityGroup, undefined);
  assert.equal((await sheet.getDayCellFormats(day)).get(702).underline, true);
  const groups = await sheet.getDayActivityGroups(day);
  assert.deepEqual(plain(groups.map((group) => [group.startMinute, group.endMinute, group.title])),
    [[600, 601, 'Coffee'], [603, 604, 'Coffee'], [700, 701, 'Work'], [703, 704, 'Work']]);
  assert.equal(new Set(groups.map((group) => group.blockId)).size, 4);
  await sheet.undoSpreadsheetEdit();
  assert.deepEqual(plain((await sheet.getDayActivityGroups(day)).map((group) => [group.blockId, group.startMinute, group.endMinute])),
    [[original, 600, 604], [destinationOriginal, 700, 704]]);
  await sheet.redoSpreadsheetEdit(); assert.equal((await sheet.getDayActivityGroups(day)).length, 4);
});

test('range drag rejects stale source, destination ABA, cancellation, untouched plans and day overflow without clearing cells', async (t) => {
  for (const changed of ['source', 'destination', 'cancel']) {
    const { api, sheet } = harness(t); await api.initializeDatabase(); await save(api, 600, 'Keep');
    const source = range(600), destination = { dateKey: '2026-10-26', startMinute: 700 };
    const held = await sheet.prepareMinuteRangeMove(source, { dateKey: day, startMinute: 600 });
    if (changed === 'source') { await save(api, 600, 'Changed'); await save(api, 600, 'Keep'); }
    const preview = await sheet.prepareMinuteRangeMove(source, destination, { sourceToken: held.token });
    if (changed === 'destination') {
      await api.saveMinuteEntry({ dateKey: destination.dateKey, minuteIndex: 700, text: 'Later', categoryId: 'study' });
      await api.deleteMinuteEntry(destination.dateKey, 700);
    }
    if (changed === 'cancel') sheet.cancelMinuteRangeMove();
    await assert.rejects(sheet.moveMinuteRange(source, destination, { previewToken: preview.token }), /changed/);
    assert.equal((await api.getMinuteEntry(day, 600)).text, 'Keep');
    assert.equal(await api.getMinuteEntry(destination.dateKey, 700), null);
    await assert.rejects(sheet.prepareMinuteRangeMove(range(600, 601), { dateKey: day, startMinute: 1439 }), /valid minute range/);
    await assert.rejects(sheet.prepareMinuteRangeMove(range(800), destination), /Calendar plans are not moved/);
  }
});

test('failed range move rolls back cells, journal, format and queued calendar work; same-place drop adds no history', async (t) => {
  const { api, sheet, sqlite, inline } = harness(t); await api.initializeDatabase();
  await save(api, 600, 'Keep'); await sheet.applyCellFormat(range(600), { bold: true });
  await inline.retryInlineMinuteLinks();
  const destination = { dateKey: '2026-10-26', startMinute: 700 };
  const before = plain(await api.getSyncDocuments(''));
  const pending = plain(await api.getPendingInlineMinuteLinks());
  const source = range(600), preview = await sheet.prepareMinuteRangeMove(source, destination);
  sqlite.exec(`CREATE TRIGGER reject_range_move BEFORE INSERT ON ledger_documents
    WHEN NEW.key = 'category:minuteFormat:2026-10-26:700' BEGIN SELECT RAISE(ABORT, 'move failed'); END;`);
  await assert.rejects(sheet.moveMinuteRange(source, destination, { previewToken: preview.token }), /move failed/);
  assert.equal((await api.getMinuteEntry(day, 600)).text, 'Keep'); assert.equal(await api.getMinuteEntry(destination.dateKey, 700), null);
  assert.deepEqual(plain(await api.getSyncDocuments('')), before); assert.deepEqual(plain(await api.getPendingInlineMinuteLinks()), pending);
  const unchanged = await sheet.prepareMinuteRangeMove(source, { dateKey: day, startMinute: 600 });
  await sheet.moveMinuteRange(source, { dateKey: day, startMinute: 600 }, { previewToken: unchanged.token });
  await sheet.undoSpreadsheetEdit();
  assert.equal((await sheet.getDayCellFormats(day)).get(600), undefined, 'Undo is the earlier bold action, not a no-op move');
});

test('canceling a selected-range move after its transaction starts restores all source and destination cells', async (t) => {
  const h = harness(t); const { api, sheet } = h; await api.initializeDatabase(); await save(api, 600, 'Keep source');
  await sheet.copyMinuteRange(range(600)); const clipboard = plain(sheet.getSpreadsheetClipboard());
  const destination = { dateKey: '2026-10-26', startMinute: 700 };
  const preview = await sheet.prepareMinuteRangeMove(range(600), destination);
  const before = plain(await api.getSyncDocuments(''));
  h.onRunAsync = async (sql) => { if (sql.startsWith('DELETE FROM minute_entries')) {
    sheet.cancelMinuteRangeMove(); h.onRunAsync = undefined;
  } };
  await assert.rejects(sheet.moveMinuteRange(range(600), destination, { previewToken: preview.token }), /canceled/);
  assert.equal((await api.getMinuteEntry(day, 600)).text, 'Keep source'); assert.equal(await api.getMinuteEntry(destination.dateKey, 700), null);
  assert.deepEqual(plain(await api.getSyncDocuments('')), before); assert.deepEqual(plain(sheet.getSpreadsheetClipboard()), clipboard);
});

test('a partial-group range move and its atomic Undo converge through the private ledger without copying group identity', async (t) => {
  const a = harness(t), b = harness(t); await a.api.initializeDatabase(); await b.api.initializeDatabase();
  await a.sheet.groupMinuteRange(range(600, 602), { title: 'Coffee', categoryId: 'family' });
  const notePreview = await a.sheet.prepareExternalMinutePaste('Talk to Mum', { dateKey: day, startMinute: 601 });
  await a.sheet.pasteExternalMinuteRange('Talk to Mum', { dateKey: day, startMinute: 601 }, { previewToken: notePreview.token });
  const original = (await a.api.getMinuteEntry(day, 601)).blockId;
  await b.api.mergeSyncDocuments(plain(await a.api.getSyncDocuments('')));
  const destination = { dateKey: '2026-10-26', startMinute: 700 };
  const preview = await a.sheet.prepareMinuteRangeMove(range(601), destination);
  await a.sheet.moveMinuteRange(range(601), destination, { previewToken: preview.token });
  await b.api.mergeSyncDocuments(plain(await a.api.getSyncDocuments('')));
  assert.equal(await b.api.getMinuteEntry(day, 601), null);
  assert.equal((await b.api.getMinuteEntry(destination.dateKey, 700)).text, 'Talk to Mum');
  assert.notEqual((await b.api.getMinuteEntry(destination.dateKey, 700)).blockId, original);
  assert.deepEqual(plain(await b.sheet.getDayActivityGroups(day)), plain(await a.sheet.getDayActivityGroups(day)));
  await a.sheet.undoSpreadsheetEdit(); await b.api.mergeSyncDocuments(plain(await a.api.getSyncDocuments('')));
  assert.equal((await b.api.getMinuteEntry(day, 601)).blockId, original);
  assert.equal(await b.api.getMinuteEntry(destination.dateKey, 700), null);
});

test('external spreadsheet rectangles paste across three dates with one Undo while preserving Context styles, fills and explicit groups', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  const next = '2026-10-26', third = '2026-10-27';
  await save(api, 100, 'Internal source', 'study'); const internal = await sheet.cutMinuteRange(range(100));
  await save(api, 200, 'Old first', 'family'); await save(api, 201, 'Old second', 'family');
  await sheet.groupMinuteRange(range(200, 201), { title: 'Existing activity', categoryId: 'family' });
  await sheet.applyCellFormat(range(200), { bold: true, underline: true, textColor: '#123456' });
  await api.saveMinuteEntry({ dateKey: next, minuteIndex: 201, text: 'Clear this note', categoryId: 'work' });
  const group = (await api.getMinuteEntry(day, 200)).blockId;
  const beforeFormats = plain([...(await sheet.getDayCellFormats(day))]);
  const text = 'Coffee\t"Talk to Mum\nBook doctor"\t=SUM(A1:A2)\n\t\tUnicode Ã¢Ëœâ€¢';
  const destination = { dateKey: day, startMinute: 200 };
  const preview = await sheet.prepareExternalMinutePaste(text, destination);
  assert.deepEqual(plain(preview.ranges), [range(200, 201), range(200, 201, next), range(200, 201, third)]);
  assert.equal(preview.rows, 2); assert.equal(preview.columns, 3); assert.equal(preview.occupiedCount, 3);
  await sheet.pasteExternalMinuteRange(text, destination, { previewToken: preview.token });
  assert.equal((await api.getMinuteEntry(day, 200)).text, 'Coffee'); assert.equal((await api.getMinuteEntry(day, 201)).text, '');
  assert.equal((await api.getMinuteEntry(day, 200)).blockId, group); assert.equal((await api.getMinuteEntry(day, 201)).blockId, group);
  assert.equal((await api.getMinuteEntry(day, 200)).categoryId, 'family');
  assert.deepEqual(plain([...(await sheet.getDayCellFormats(day))]), beforeFormats);
  assert.equal((await api.getMinuteEntry(next, 200)).text, 'Talk to Mum\nBook doctor');
  assert.equal((await api.getMinuteEntry(next, 201)).text, ''); assert.equal((await api.getMinuteEntry(next, 201)).categoryId, 'work');
  assert.equal((await api.getMinuteEntry(third, 200)).text, '=SUM(A1:A2)', 'formulas stay literal text');
  assert.equal((await api.getMinuteEntry(third, 201)).text, 'Unicode Ã¢Ëœâ€¢');
  assert.notEqual((await api.getMinuteEntry(third, 200)).blockId, (await api.getMinuteEntry(third, 201)).blockId,
    'external text must not invent a common activity/group identity');
  assert.equal((await api.getMinuteEntry(next, 200)).categoryId, 'unaccounted');
  assert.deepEqual(plain(sheet.getSpreadsheetClipboard()), plain(internal));
  assert.equal((await api.getMinuteEntry(day, 100)).text, 'Internal source', 'external paste never executes a pending internal Cut');
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 200)).text, 'Old first');
  assert.equal((await api.getMinuteEntry(day, 201)).text, 'Old second');
  assert.equal(await api.getMinuteEntry(next, 200), null); assert.equal((await api.getMinuteEntry(next, 201)).text, 'Clear this note');
  assert.equal((await api.getDayEntries(third)).length, 0);
  await sheet.redoSpreadsheetEdit(); assert.equal((await api.getMinuteEntry(third, 201)).text, 'Unicode Ã¢Ëœâ€¢');
  assert.deepEqual(plain(sheet.getSpreadsheetClipboard()), plain(internal));
});

test('external single-cell Paste fills the selected range and blank fields remain blank without inventing minutes', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await sheet.pasteExternalMinuteRange('Read Codex', { dateKey: day, startMinute: 719, endMinute: 722 });
  assert.deepEqual((await api.getDayEntries(day)).map((entry) => entry.text), Array(4).fill('Read Codex'));
  assert.equal(new Set((await api.getDayEntries(day)).map((entry) => entry.blockId)).size, 4);
  await sheet.undoSpreadsheetEdit(); assert.equal((await api.getDayEntries(day)).length, 0);
  await sheet.pasteExternalMinuteRange('a\t\nb\t', { dateKey: day, startMinute: 10 });
  assert.equal((await api.getDayEntries('2026-10-26')).length, 0);
  assert.deepEqual((await api.getDayEntries(day)).map((entry) => entry.text), ['a', 'b']);
});

test('fill Reset keeps notes and styles, removes empty colored ghost records, and Undo/Redo restores the exact range', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await save(api, 300, 'Keep my words', 'family'); await sheet.colorMinuteRange(range(301), 'family');
  await sheet.applyCellFormat(range(300, 301), { bold: true, textColor: '#123456' });
  await sheet.resetMinuteFill(range(300, 302));
  assert.equal((await api.getMinuteEntry(day, 300)).text, 'Keep my words');
  assert.equal((await api.getMinuteEntry(day, 300)).categoryId, 'unaccounted');
  assert.equal(await api.getMinuteEntry(day, 301), null); assert.equal(await api.getMinuteEntry(day, 302), null);
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(300)), { bold: true, textColor: '#123456', noFill: true });
  assert.equal((await api.getCategoryTimeTotals(day, day)).reduce((sum, row) => sum + row.minutes, 0), 1);
  await sheet.undoSpreadsheetEdit(); assert.equal((await api.getMinuteEntry(day, 301)).categoryId, 'family');
  assert.equal((await api.getMinuteEntry(day, 300)).categoryId, 'family');
  assert.equal((await sheet.getDayCellFormats(day)).get(300).noFill, undefined);
  await sheet.redoSpreadsheetEdit(); assert.equal(await api.getMinuteEntry(day, 301), null);
  await sheet.applyCellFormat(range(300), { textColor: null });
  assert.equal((await api.getMinuteEntry(day, 300)).text, 'Keep my words');
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(300)), { bold: true, noFill: true });
  await sheet.clearTextMinuteRange(range(300)); assert.equal(await api.getMinuteEntry(day, 300), null);
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(300)), { bold: true, noFill: true });
  await sheet.undoSpreadsheetEdit(); assert.equal((await api.getMinuteEntry(day, 300)).text, 'Keep my words');
});

test('fill Reset preserves blank group membership, and explicit color/group/fill removes the no-fill override', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await save(api, 400, 'Grouped note', 'family'); await sheet.groupMinuteRange(range(400, 401), { title: 'Activity', categoryId: 'family' });
  const block = (await api.getMinuteEntry(day, 400)).blockId;
  await sheet.resetMinuteFill(range(400, 401));
  for (const minute of [400, 401]) { assert.equal((await api.getMinuteEntry(day, minute)).blockId, block);
    assert.equal((await api.getMinuteEntry(day, minute)).categoryId, 'unaccounted');
    assert.equal((await sheet.getDayCellFormats(day)).get(minute).noFill, true); }
  assert.equal((await api.getMinuteEntry(day, 401)).text, '');
  await sheet.colorMinuteRange(range(400), 'family'); assert.equal((await sheet.getDayCellFormats(day)).get(400).noFill, undefined);
  await sheet.groupMinuteRange(range(400, 401), { title: 'Activity', categoryId: 'family' });
  assert.equal((await sheet.getDayCellFormats(day)).get(401).noFill, undefined);
  await sheet.resetMinuteFill(range(400, 401));
  await sheet.fillMinuteRange(range(400, 401), 400, 'family');
  assert.equal((await sheet.getDayCellFormats(day)).get(401).noFill, undefined);
  assert.equal((await api.getMinuteEntry(day, 401)).text, 'Grouped note');
});

test('no-fill metadata survives the released encrypted-ledger whitelist and private-ledger replay', async (t) => {
  const first = harness(t), second = harness(t); await first.api.initializeDatabase(); await second.api.initializeDatabase();
  await save(first.api, 500, 'Retain note', 'family'); await first.sheet.resetMinuteFill(range(500));
  const documents = plain(await first.api.getSyncDocuments(''));
  const codec = first.load(first.source('sync/codec.ts'));
  assert.doesNotThrow(() => codec.validateBatch({ version: 1, id: 'no_fill_metadata', documents }));
  await second.api.mergeSyncDocuments(documents);
  assert.equal((await second.api.getMinuteEntry(day, 500)).text, 'Retain note');
  assert.equal((await second.sheet.getDayCellFormats(day)).get(500).noFill, true);
});

test('a format write failure rolls fill Reset back without deleting colored blanks or losing notes', async (t) => {
  const { api, sheet, sqlite } = harness(t); await api.initializeDatabase();
  await save(api, 600, 'Keep note', 'family'); await sheet.colorMinuteRange(range(601), 'family');
  const before = plain(await api.getSyncDocuments(''));
  sqlite.exec(`CREATE TRIGGER reject_reset BEFORE INSERT ON ledger_documents
    WHEN NEW.key = 'category:minuteFormat:2026-10-25:601' BEGIN SELECT RAISE(ABORT, 'injected Reset failure'); END;`);
  await assert.rejects(sheet.resetMinuteFill(range(600, 601)), /injected Reset failure/);
  assert.equal((await api.getMinuteEntry(day, 600)).text, 'Keep note');
  assert.equal((await api.getMinuteEntry(day, 600)).categoryId, 'family');
  assert.equal((await api.getMinuteEntry(day, 601)).categoryId, 'family');
  assert.deepEqual(plain(await api.getSyncDocuments('')), before);
});

test('external edge whitespace and quoted CRLF notes survive SQLite, Undo/Redo, internal Copy and explicit formatting/grouping', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  const first = '  Ã¢Ëœâ€¢ coffee  ', second = '\r\n talk\tMum \r\n';
  const text = `"${first}"\t"${second}"`, destination = { dateKey: day, startMinute: 500 };
  await save(api, 500, 'Previous note', 'family');
  const preview = await sheet.prepareExternalMinutePaste(text, destination);
  await sheet.pasteExternalMinuteRange(text, destination, { previewToken: preview.token });
  assert.equal((await api.getMinuteEntry(day, 500)).text, first);
  assert.equal((await api.getMinuteEntry('2026-10-26', 500)).text, second);
  const documents = await api.getSyncDocuments('minute:');
  assert.equal(documents.find((value) => value.key === `minute:${day}:500`).value.text, first);
  await sheet.undoSpreadsheetEdit(); assert.equal((await api.getMinuteEntry(day, 500)).text, 'Previous note');
  assert.equal(await api.getMinuteEntry('2026-10-26', 500), null);
  await sheet.redoSpreadsheetEdit(); assert.equal((await api.getMinuteEntry(day, 500)).text, first);
  assert.equal((await api.getMinuteEntry('2026-10-26', 500)).text, second);
  // A whitespace-only difference is real clipboard data, so it must neither be
  // mistaken for a no-op nor invalidate the later Undo's expected text guard.
  const whitespace = await sheet.prepareExternalMinutePaste('Ã¢Ëœâ€¢ coffee', destination);
  await sheet.pasteExternalMinuteRange('Ã¢Ëœâ€¢ coffee', destination, { previewToken: whitespace.token });
  assert.equal((await api.getMinuteEntry(day, 500)).text, 'Ã¢Ëœâ€¢ coffee');
  await sheet.undoSpreadsheetEdit(); assert.equal((await api.getMinuteEntry(day, 500)).text, first);
  await sheet.copyMinuteRange(range(500)); assert.equal(sheet.getSpreadsheetClipboardText(), first);
  await sheet.pasteMinuteRange({ dateKey: day, startMinute: 501 });
  assert.equal((await api.getMinuteEntry(day, 501)).text, first);
  await sheet.applyCellFormat(range(500, 501), { italic: true });
  await sheet.groupMinuteRange(range(500, 501), { title: 'Coffee notes', categoryId: 'family' });
  assert.equal((await api.getMinuteEntry(day, 500)).text, first);
  assert.equal((await api.getMinuteEntry(day, 501)).text, first);
  assert.equal((await sheet.getDayCellFormats(day)).get(501).italic, true);
  await sheet.undoSpreadsheetEdit(); assert.equal((await api.getMinuteEntry(day, 501)).text, first);
  await sheet.redoSpreadsheetEdit(); assert.equal((await api.getMinuteEntry(day, 500)).text, first);
});

test('external Paste previews the entire rectangle and rejects changed text, destination, or any later destination revision', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await api.saveMinuteEntry({ dateKey: '2026-10-27', minuteIndex: 501, text: 'Review last target', categoryId: 'family' });
  const text = 'a\tb\tc\nd\te\tf', destination = { dateKey: day, startMinute: 500 };
  await assert.rejects(sheet.pasteExternalMinuteRange(text, destination), /Review the destination/);
  assert.equal((await api.getDayEntries(day)).length, 0);
  const preview = await sheet.prepareExternalMinutePaste(text, destination); assert.equal(preview.occupiedCount, 1);
  await assert.rejects(sheet.pasteExternalMinuteRange(text + 'x', destination, { previewToken: preview.token }), /text or destination changed/);
  await assert.rejects(sheet.pasteExternalMinuteRange(text, { ...destination, startMinute: 499 }, { previewToken: preview.token }), /text or destination changed/);
  await api.saveMinuteEntry({ dateKey: '2026-10-27', minuteIndex: 501, text: 'Changed', categoryId: 'family' });
  await api.saveMinuteEntry({ dateKey: '2026-10-27', minuteIndex: 501, text: 'Review last target', categoryId: 'family' });
  const before = plain(await api.getSyncDocuments(''));
  await assert.rejects(sheet.pasteExternalMinuteRange(text, destination, { previewToken: preview.token }), /changed/);
  assert.equal((await api.getDayEntries(day)).length, 0); assert.equal((await api.getDayEntries('2026-10-26')).length, 0);
  assert.deepEqual(plain(await api.getSyncDocuments('')), before);
});

test('a failure on the third day rolls external text, ledger, and calendar-link work back across all dates', async (t) => {
  const { api, sheet, sqlite } = harness(t); await api.initializeDatabase();
  const text = 'a\tb\tc\nd\te\tf', destination = { dateKey: day, startMinute: 600 };
  const preview = await sheet.prepareExternalMinutePaste(text, destination);
  const before = plain(await api.getSyncDocuments('')); const pending = plain(await api.getPendingInlineMinuteLinks());
  const outbox = plain(sqlite.prepare('SELECT * FROM sync_outbox ORDER BY date_key').all());
  sqlite.exec(`CREATE TRIGGER reject_external_paste BEFORE INSERT ON minute_entries
    WHEN NEW.date_key = '2026-10-27' AND NEW.minute_index = 601 BEGIN SELECT RAISE(ABORT, 'injected external failure'); END;`);
  await assert.rejects(sheet.pasteExternalMinuteRange(text, destination, { previewToken: preview.token }), /injected external failure/);
  for (const date of [day, '2026-10-26', '2026-10-27']) assert.equal((await api.getDayEntries(date)).length, 0);
  assert.deepEqual(plain(await api.getSyncDocuments('')), before); assert.deepEqual(plain(await api.getPendingInlineMinuteLinks()), pending);
  assert.deepEqual(plain(sqlite.prepare('SELECT * FROM sync_outbox ORDER BY date_key').all()), outbox);
  assert.equal(sheet.spreadsheetEditor.snapshot().canUndo, false);
});

test('canceling an external paste during its transaction leaves no partial cells and does not change internal Copy', async (t) => {
  const h = harness(t); const { api, sheet } = h; await api.initializeDatabase();
  await save(api, 100, 'Keep internal'); const internal = await sheet.copyMinuteRange(range(100));
  const text = 'a\tb\nc\td', destination = { dateKey: day, startMinute: 700 };
  const preview = await sheet.prepareExternalMinutePaste(text, destination); const before = plain(await api.getSyncDocuments(''));
  h.onRunAsync = async (sql) => { if (sql.startsWith('INSERT INTO minute_entries')) {
    sheet.cancelExternalMinutePaste(); h.onRunAsync = undefined; } };
  await assert.rejects(sheet.pasteExternalMinuteRange(text, destination, { previewToken: preview.token }), /canceled/);
  assert.equal(await api.getMinuteEntry(day, 700), null); assert.equal((await api.getDayEntries('2026-10-26')).length, 0);
  assert.deepEqual(plain(await api.getSyncDocuments('')), before); assert.deepEqual(plain(sheet.getSpreadsheetClipboard()), plain(internal));
});

test('internal clipboard text comes from its captured snapshot and large snapshots remain usable internally', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await save(api, 100, 'Coffee\nTalk to Mum'); await sheet.copyMinuteRange(range(100, 101));
  await save(api, 100, 'Later source change');
  assert.equal(sheet.getSpreadsheetClipboardText(), '"Coffee\nTalk to Mum"\n""');
  await save(api, 200, 'x'.repeat(50_001)); const large = await sheet.copyMinuteRange(range(200));
  assert.equal(sheet.getSpreadsheetClipboardText(), null);
  assert.deepEqual(plain(sheet.getSpreadsheetClipboard()), plain(large));
  await sheet.pasteMinuteRange({ dateKey: day, startMinute: 201 });
  assert.equal((await api.getMinuteEntry(day, 201)).text.length, 50_001);
});

test('external paste bounds fail before mutation and a 31-day rectangle is still one undoable transaction', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  const before = plain(await api.getSyncDocuments(''));
  assert.throws(() => sheet.prepareExternalMinutePaste('a\nb', { dateKey: day, startMinute: 1439 }), /midnight/);
  assert.throws(() => sheet.prepareExternalMinutePaste('a\tb', { dateKey: '9999-12-31', startMinute: 1 }), /supported/);
  assert.deepEqual(plain(await api.getSyncDocuments('')), before);
  const text = Array.from({ length: 31 }, (_, index) => String(index + 1)).join('\t');
  await sheet.pasteExternalMinuteRange(text, { dateKey: day, startMinute: 1439 });
  assert.equal((await api.getMinuteEntry('2026-11-24', 1439)).text, '31');
  await sheet.undoSpreadsheetEdit(); assert.equal((await api.getEntriesBetween(day, '2026-11-24')).length, 0);
});

test('the shared transaction validates date count, duplicate dates and total cell budget before changing any day', async (t) => {
  const { api } = harness(t); await api.initializeDatabase(); await save(api, 0, 'Keep existing');
  const before = plain(await api.getSyncDocuments(''));
  const change = (index, count = 1) => {
    const target = Array.from({ length: count }, (_, minuteIndex) => ({ minuteIndex, entry: null, format: {} }));
    return { day: new Date(Date.UTC(2026, 9, 25 + index)).toISOString().slice(0, 10), target, expected: target };
  };
  for (const changes of [Array.from({ length: 32 }, (_, index) => change(index)),
    [change(0), change(0)], Array.from({ length: 31 }, (_, index) => change(index, 324))]) {
    await assert.rejects(api.applySpreadsheetTransaction(changes, { textChanged: true, formatChanged: true }), /Invalid spreadsheet transaction/);
  }
  assert.equal((await api.getMinuteEntry(day, 0)).text, 'Keep existing');
  assert.deepEqual(plain(await api.getSyncDocuments('')), before);
});

function harness(t) {
  const sqlite = new DatabaseSync(':memory:');
  let onRunAsync;
  let onLink;
  const linkCalls = [];
  const native = {
    async execAsync(sql) { sqlite.exec(sql); },
    async runAsync(sql, ...params) { if (onRunAsync) await onRunAsync(sql, params);
      const result = sqlite.prepare(sql).run(...params); return { changes: result.changes }; },
    async getFirstAsync(sql, ...params) { return sqlite.prepare(sql).get(...params) ?? null; },
    async getAllAsync(sql, ...params) { return sqlite.prepare(sql).all(...params); },
    async withExclusiveTransactionAsync(work) { sqlite.exec('BEGIN IMMEDIATE'); try { await work(native); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; } },
  };
  const cache = new Map();
  const source = (file) => path.join(__dirname, '../src', file);
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} };
    cache.set(filename, module.exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInContext(code, vm.createContext({ module, exports: module.exports, console, Date, Math, Intl,
      Map, Set, Promise, Error, TypeError, RangeError, TextEncoder, TextDecoder, Uint8Array, setTimeout, clearTimeout,
      require(name) {
        if (name === 'expo-sqlite') return { openDatabaseAsync: async () => native };
        if (name === 'expo-crypto') return { randomUUID: crypto.randomUUID };
        if (name.startsWith('@noble/')) return require(name);
        if (!name.startsWith('.')) throw new Error(`Unexpected sheet import: ${name}`);
        const file = path.resolve(path.dirname(filename), `${name}.ts`);
        if (file === source('sync/engine.ts')) return { linkActualsToAccounts: async (...args) => { linkCalls.push(args); if (onLink) await onLink(...args); }, subscribeAccountSync: () => () => {}, requestAccountSynchronization: () => {}, synchronizeAccounts: async () => {} };
        if (file === source('sync/accounts.ts')) return { accountFetch: async () => { throw new Error('Unexpected account request'); } };
        if (file === source('sync/providers.ts')) return { createCalendarAdapter: () => { throw new Error('Unexpected calendar request'); } };
        return load(file);
      },
    }), { filename });
    cache.set(filename, module.exports);
    return module.exports;
  }
  const api = load(source('data/database.ts'));
  const sheet = load(source('services/spreadsheet.ts'));
  const inline = load(source('services/inline-minutes.ts'));
  t.after(async () => {
    try { await inline.flushInlineMinutes(); await inline.retryInlineMinuteLinks(); }
    finally { sqlite.close(); }
  });
  return { api, sheet, inline, sqlite, load, source, linkCalls, set onRunAsync(callback) { onRunAsync = callback; },
    set onLink(callback) { onLink = callback; } };
}
const range = (startMinute, endMinute = startMinute, dateKey = day) => ({ dateKey, startMinute, endMinute });
async function save(api, minuteIndex, text, categoryId = 'study') {
  await api.saveMinuteEntry({ dateKey: day, minuteIndex, text, categoryId });
}
function activate(inline, minuteIndex, text, categoryId = 'study') {
  inline.inlineMinuteDrafts.activate({ dateKey: day, minuteIndex, text, categoryId, keepColor: false });
}

test('local clipboard and Clear acknowledge SQLite while account linking is still pending', async (t) => {
  const r = harness(t); await r.api.initializeDatabase();
  await save(r.api, 100, 'Original', 'family'); await r.sheet.applyCellFormat(range(100), { bold: true });
  let release;
  const network = new Promise((resolve) => { release = resolve; });
  r.onLink = () => network;
  activate(r.inline, 100, 'Original', 'family'); r.sheet.editInlineMinute(day, 100, { text: 'Latest whole cell' });
  await r.inline.inlineMinuteDrafts.flushAll(); await setImmediate();
  const accountStarted = r.linkCalls.length > 0;
  let locallyComplete = false;
  const editing = (async () => {
    await r.sheet.copyMinuteRange(range(100));
    await r.sheet.pasteMinuteRange({ dateKey: day, startMinute: 200 });
    await r.sheet.clearTextMinuteRange(range(200));
    await r.sheet.cutMinuteRange(range(100));
    await r.sheet.pasteMinuteRange({ dateKey: day, startMinute: 300 });
    locallyComplete = true;
  })();
  for (let turn = 0; turn < 3; turn++) await setImmediate();
  const completedBeforeAccount = locallyComplete;
  release(); await editing;
  assert.ok(accountStarted, 'the account boundary is held by an in-flight link request');
  assert.equal(completedBeforeAccount, true, 'clipboard commands must not wait for an account round trip');
  assert.equal(await r.api.getMinuteEntry(day, 100), null);
  assert.equal((await r.api.getMinuteEntry(day, 200)).text, '');
  assert.equal((await r.api.getMinuteEntry(day, 300)).text, 'Latest whole cell');
  assert.equal((await r.api.getMinuteEntry(day, 300)).categoryId, 'family');
  assert.equal((await r.sheet.getDayCellFormats(day)).get(300).bold, true);
});

test('Copy keeps an internal stable cell snapshot, pastes across dates, and remains available for another Paste', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  const tomorrow = '2026-10-26';
  await save(api, 100, 'Original thought', 'family');
  await sheet.applyCellFormat(range(100), { bold: true, textColor: '#123456' });
  await sheet.applyCellFormat(range(101), { italic: true });
  const original = await api.getMinuteEntry(day, 100);
  const clipboard = await sheet.copyMinuteRange(range(100, 101));
  assert.deepEqual(plain(sheet.spreadsheetEditor.snapshot().clipboard), plain(clipboard));
  await save(api, 100, 'Later source change', 'work');
  const preview = await sheet.prepareMinutePaste({ dateKey: tomorrow, startMinute: 200 });
  assert.equal(preview.occupiedCount, 0);
  await sheet.pasteMinuteRange({ dateKey: tomorrow, startMinute: 200 }, { previewToken: preview.token });
  const copied = await api.getMinuteEntry(tomorrow, 200);
  assert.equal(copied.text, 'Original thought'); assert.equal(copied.categoryId, 'family');
  assert.notEqual(copied.id, original.id); assert.notEqual(copied.blockId, original.blockId);
  assert.deepEqual(plain((await sheet.getDayCellFormats(tomorrow)).get(200)), { bold: true, textColor: '#123456' });
  assert.equal(await api.getMinuteEntry(tomorrow, 201), null, 'format-only blanks remain unrecorded time');
  assert.deepEqual(plain((await sheet.getDayCellFormats(tomorrow)).get(201)), { italic: true });
  assert.equal((await api.getMinuteEntry(day, 100)).text, 'Later source change');
  assert.equal(sheet.getSpreadsheetClipboard().mode, 'copy');
  await sheet.pasteMinuteRange({ dateKey: tomorrow, startMinute: 300 });
  assert.equal((await api.getMinuteEntry(tomorrow, 300)).text, 'Original thought');
  assert.notEqual((await api.getMinuteEntry(tomorrow, 300)).id, copied.id);
  await sheet.undoSpreadsheetEdit();
  assert.equal(await api.getMinuteEntry(tomorrow, 300), null);
  assert.equal((await api.getMinuteEntry(tomorrow, 200)).text, 'Original thought');
  sheet.clearSpreadsheetClipboard(); assert.equal(sheet.getSpreadsheetClipboard(), null);
});

test('one copied cell fills every selected destination with its saved text, fill and format in one Undo command', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  const tomorrow = '2026-10-26';
  await save(api, 100, 'Make coffee', 'family'); await save(api, 101, 'Talk to Mum', 'family');
  await sheet.groupMinuteRange(range(100, 101), { title: 'Morning coffee', categoryId: 'family' });
  await sheet.applyCellFormat(range(100), { bold: true, italic: true, underline: true, textColor: '#123456' });
  const source = await api.getMinuteEntry(day, 100);
  const sourceFormat = plain((await sheet.getDayCellFormats(day)).get(100));
  await api.saveMinuteEntry({ dateKey: tomorrow, minuteIndex: 201, text: 'Earlier note', categoryId: 'study' });
  await sheet.applyCellFormat(range(202, 202, tomorrow), { italic: true });
  await api.saveMinuteEntry({ dateKey: tomorrow, minuteIndex: 204, text: 'Outside', categoryId: 'work' });
  await sheet.copyMinuteRange(range(100));
  await save(api, 100, 'Later source note', 'family');
  const destination = { dateKey: tomorrow, startMinute: 200, endMinute: 203 };
  await assert.rejects(sheet.pasteMinuteRange(destination), /Review the destination/);
  const preview = await sheet.prepareMinutePaste(destination);
  assert.deepEqual(plain(preview.range), range(200, 203, tomorrow)); assert.equal(preview.occupiedCount, 2);
  await sheet.pasteMinuteRange(destination, { previewToken: preview.token });
  const expectedFormat = { bold: true, italic: true, underline: true, textColor: '#123456' };
  for (let minute = 200; minute <= 203; minute++) {
    const value = await api.getMinuteEntry(tomorrow, minute);
    assert.equal(value.text, 'Make coffee'); assert.equal(value.categoryId, 'family');
    assert.notEqual(value.blockId, source.blockId); assert.notEqual(value.id, source.id);
    assert.deepEqual(plain((await sheet.getDayCellFormats(tomorrow)).get(minute)), expectedFormat,
      'copying a grouped member broadcasts formatting without copying the original group identity/title');
  }
  assert.equal((await api.getMinuteEntry(day, 100)).text, 'Later source note');
  assert.equal((await api.getMinuteEntry(day, 101)).blockId, source.blockId);
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(100)), sourceFormat);
  assert.equal((await api.getMinuteEntry(tomorrow, 204)).text, 'Outside');
  assert.equal(sheet.getSpreadsheetClipboard().count, 1);
  await sheet.undoSpreadsheetEdit();
  assert.equal(await api.getMinuteEntry(tomorrow, 200), null);
  assert.equal((await api.getMinuteEntry(tomorrow, 201)).text, 'Earlier note');
  assert.equal(await api.getMinuteEntry(tomorrow, 202), null);
  assert.deepEqual(plain((await sheet.getDayCellFormats(tomorrow)).get(202)), { italic: true });
  assert.equal(await api.getMinuteEntry(tomorrow, 203), null);
  await sheet.redoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(tomorrow, 203)).text, 'Make coffee');
  assert.deepEqual(plain((await sheet.getDayCellFormats(tomorrow)).get(203)), expectedFormat);
});

test('broadcast Paste confirmation guards the full selected range and rejects a later member ABA edit', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await save(api, 100, 'Source'); await save(api, 302, 'Last destination');
  await sheet.copyMinuteRange(range(100));
  const destination = { dateKey: day, startMinute: 300, endMinute: 302 };
  const preview = await sheet.prepareMinutePaste(destination);
  await assert.rejects(sheet.pasteMinuteRange({ ...destination, endMinute: 303 }, { previewToken: preview.token }), /clipboard or destination changed/);
  await save(api, 302, 'Changed'); await save(api, 302, 'Last destination');
  const documents = plain(await api.getSyncDocuments(''));
  await assert.rejects(sheet.pasteMinuteRange(destination, { previewToken: preview.token }), /changed/);
  assert.equal(await api.getMinuteEntry(day, 300), null); assert.equal(await api.getMinuteEntry(day, 301), null);
  assert.equal((await api.getMinuteEntry(day, 302)).text, 'Last destination');
  assert.deepEqual(plain(await api.getSyncDocuments('')), documents);
  assert.equal((await api.getMinuteEntry(day, 100)).text, 'Source');
  const nextPreview = await sheet.prepareMinutePaste(destination);
  await sheet.copyMinuteRange(range(302));
  await assert.rejects(sheet.pasteMinuteRange(destination, { previewToken: nextPreview.token }), /clipboard or destination changed/);
});

test('a middle broadcast write failure rolls back all minutes, formatting, ledger and pending links', async (t) => {
  const { api, sheet, sqlite } = harness(t); await api.initializeDatabase();
  await save(api, 100, 'Source', 'family'); await save(api, 401, 'Keep destination', 'work');
  await sheet.applyCellFormat(range(100), { underline: true }); await sheet.copyMinuteRange(range(100));
  const destination = { dateKey: day, startMinute: 400, endMinute: 402 };
  const preview = await sheet.prepareMinutePaste(destination);
  sqlite.exec(`CREATE TRIGGER reject_broadcast_format BEFORE INSERT ON ledger_documents
    WHEN NEW.key = 'category:minuteFormat:2026-10-25:401' BEGIN SELECT RAISE(ABORT, 'injected broadcast failure'); END;`);
  const documents = plain(await api.getSyncDocuments(''));
  const outbox = plain(sqlite.prepare('SELECT * FROM sync_outbox ORDER BY date_key').all());
  const links = plain(await api.getPendingInlineMinuteLinks());
  await assert.rejects(sheet.pasteMinuteRange(destination, { previewToken: preview.token }), /injected broadcast failure/);
  assert.equal(await api.getMinuteEntry(day, 400), null); assert.equal(await api.getMinuteEntry(day, 402), null);
  assert.equal((await api.getMinuteEntry(day, 401)).text, 'Keep destination');
  assert.equal((await api.getMinuteEntry(day, 401)).categoryId, 'work');
  assert.deepEqual(plain(await api.getSyncDocuments('')), documents);
  assert.deepEqual(plain(sqlite.prepare('SELECT * FROM sync_outbox ORDER BY date_key').all()), outbox);
  assert.deepEqual(plain(await api.getPendingInlineMinuteLinks()), links);
  assert.equal(sheet.getSpreadsheetClipboard().mode, 'copy');
});

test('broadcasting a format-only blank does not invent recorded minutes and supports the last minute of the day', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await sheet.applyCellFormat(range(100), { italic: true, textColor: '#ABCDEF' }); await sheet.copyMinuteRange(range(100));
  const destination = { dateKey: '2026-10-26', startMinute: 1437, endMinute: 1439 };
  const preview = await sheet.prepareMinutePaste(destination); assert.equal(preview.occupiedCount, 0);
  await sheet.pasteMinuteRange(destination, { previewToken: preview.token });
  assert.equal((await api.getDayEntries(destination.dateKey)).length, 0);
  for (let minute = 1437; minute <= 1439; minute++) assert.deepEqual(
    plain((await sheet.getDayCellFormats(destination.dateKey)).get(minute)), { italic: true, textColor: '#ABCDEF' });
  for (const invalid of [{ endMinute: 1440 }, { endMinute: 1436 }, { endMinute: 1438.5 }, { dateKey: '2026-02-30' }]) {
    await assert.rejects(sheet.prepareMinutePaste({ ...destination, ...invalid }), /valid minute range/);
  }
  await sheet.undoSpreadsheetEdit();
  assert.equal((await sheet.getDayCellFormats(destination.dateKey)).size, 0);
});

test('single-cell Cut remains one move and multi-cell Copy remains sequential despite a larger selected destination', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await save(api, 100, 'Move one', 'family'); await save(api, 301, 'Keep selection remainder', 'work');
  await sheet.cutMinuteRange(range(100));
  const destination = { dateKey: day, startMinute: 300, endMinute: 304 };
  const cutPreview = await sheet.prepareMinutePaste(destination);
  assert.deepEqual(plain(cutPreview.range), range(300)); assert.equal(cutPreview.occupiedCount, 0);
  await sheet.pasteMinuteRange(destination, { previewToken: cutPreview.token });
  assert.equal(await api.getMinuteEntry(day, 100), null); assert.equal((await api.getMinuteEntry(day, 300)).text, 'Move one');
  assert.equal((await api.getMinuteEntry(day, 301)).text, 'Keep selection remainder');
  assert.equal(await api.getMinuteEntry(day, 302), null); assert.equal(sheet.getSpreadsheetClipboard(), null);
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 100)).text, 'Move one'); assert.equal(await api.getMinuteEntry(day, 300), null);
  await save(api, 101, 'Second copied cell', 'study'); await sheet.copyMinuteRange(range(100, 101));
  const multiPreview = await sheet.prepareMinutePaste(destination);
  assert.deepEqual(plain(multiPreview.range), range(300, 301)); assert.equal(multiPreview.occupiedCount, 1);
  await sheet.pasteMinuteRange(destination, { previewToken: multiPreview.token });
  assert.equal((await api.getMinuteEntry(day, 300)).text, 'Move one');
  assert.equal((await api.getMinuteEntry(day, 301)).text, 'Second copied cell');
  assert.equal(await api.getMinuteEntry(day, 302), null); assert.equal((await api.getMinuteEntry(day, 100)).text, 'Move one');
});

test('canceling a copied-cell broadcast during its transaction never leaves a partly filled selection', async (t) => {
  const h = harness(t); const { api, sheet } = h; await api.initializeDatabase();
  await save(api, 100, 'Source'); await sheet.copyMinuteRange(range(100));
  const destination = { dateKey: day, startMinute: 600, endMinute: 602 };
  const preview = await sheet.prepareMinutePaste(destination);
  const documents = plain(await api.getSyncDocuments(''));
  h.onRunAsync = async (sql) => {
    if (sql.startsWith('INSERT INTO minute_entries')) { sheet.clearSpreadsheetClipboard(); h.onRunAsync = undefined; }
  };
  await assert.rejects(sheet.pasteMinuteRange(destination, { previewToken: preview.token }), /Paste was canceled/);
  for (let minute = 600; minute <= 602; minute++) assert.equal(await api.getMinuteEntry(day, minute), null);
  assert.equal((await api.getMinuteEntry(day, 100)).text, 'Source');
  assert.deepEqual(plain(await api.getSyncDocuments('')), documents);
});

test('Cut waits for atomic cross-day Paste; occupied destinations are reviewed and one Undo restores both dates', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  const tomorrow = '2026-10-26'; const commits = [];
  sheet.subscribeSpreadsheetCommits((event) => commits.push(plain(event)));
  await save(api, 600, 'Talk to Mum', 'family'); await save(api, 601, 'Make appointment', 'work');
  await sheet.applyCellFormat(range(600), { bold: true });
  await api.saveMinuteEntry({ dateKey: tomorrow, minuteIndex: 700, text: 'Old destination', categoryId: 'study' });
  const source = await api.getMinuteEntry(day, 600);
  await sheet.cutMinuteRange(range(600, 601));
  assert.equal((await api.getMinuteEntry(day, 600)).text, 'Talk to Mum', 'Cut alone never deletes anything');
  await assert.rejects(sheet.pasteMinuteRange({ dateKey: tomorrow, startMinute: 700 }), /Review the destination/);
  assert.equal((await api.getMinuteEntry(day, 600)).text, 'Talk to Mum');
  const preview = await sheet.prepareMinutePaste({ dateKey: tomorrow, startMinute: 700 });
  assert.equal(preview.occupiedCount, 1);
  await sheet.pasteMinuteRange({ dateKey: tomorrow, startMinute: 700 }, { previewToken: preview.token });
  assert.equal(await api.getMinuteEntry(day, 600), null); assert.equal(await api.getMinuteEntry(day, 601), null);
  assert.equal((await api.getMinuteEntry(tomorrow, 700)).text, 'Talk to Mum');
  assert.equal((await api.getMinuteEntry(tomorrow, 701)).text, 'Make appointment');
  assert.notEqual((await api.getMinuteEntry(tomorrow, 700)).id, source.id);
  assert.deepEqual(plain((await sheet.getDayCellFormats(tomorrow)).get(700)), { bold: true });
  assert.deepEqual(commits.at(-1).affectedDates.sort(), [day, tomorrow]);
  assert.equal(sheet.getSpreadsheetClipboard(), null);
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 600)).text, 'Talk to Mum');
  assert.equal((await api.getMinuteEntry(day, 601)).text, 'Make appointment');
  assert.equal((await api.getMinuteEntry(tomorrow, 700)).text, 'Old destination');
  assert.equal(await api.getMinuteEntry(tomorrow, 701), null);
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(600)), { bold: true });
  await sheet.redoSpreadsheetEdit();
  assert.equal(await api.getMinuteEntry(day, 600), null);
  assert.equal((await api.getMinuteEntry(tomorrow, 700)).text, 'Talk to Mum');
});

test('overlapping same-day Cut/Paste uses a snapshot and destination wins, with atomic Undo/Redo', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  for (const [offset, text] of ['A', 'B', 'C', 'Old D'].entries()) await save(api, 100 + offset, text);
  await sheet.cutMinuteRange(range(100, 102));
  const preview = await sheet.prepareMinutePaste({ dateKey: day, startMinute: 101 });
  await sheet.pasteMinuteRange({ dateKey: day, startMinute: 101 }, { previewToken: preview.token });
  assert.deepEqual(await Promise.all([100, 101, 102, 103].map(async (minute) => (await api.getMinuteEntry(day, minute))?.text ?? null)), [null, 'A', 'B', 'C']);
  await sheet.undoSpreadsheetEdit();
  assert.deepEqual(await Promise.all([100, 101, 102, 103].map(async (minute) => (await api.getMinuteEntry(day, minute))?.text ?? null)), ['A', 'B', 'C', 'Old D']);
  await sheet.redoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 103)).text, 'C');
});

test('Cut refuses source text or format edits including ABA changes, keeping both dates and the clipboard intact', async (t) => {
  for (const kind of ['text', 'format']) {
    const { api, sheet } = harness(t); await api.initializeDatabase();
    await save(api, 500, 'Original', 'work'); await sheet.applyCellFormat(range(500), { bold: true });
    await sheet.cutMinuteRange(range(500));
    const destination = { dateKey: '2026-10-26', startMinute: 500 };
    const preview = await sheet.prepareMinutePaste(destination);
    if (kind === 'text') {
      await save(api, 500, 'Changed', 'work'); await save(api, 500, 'Original', 'work');
    } else {
      await sheet.applyCellFormat(range(500), { bold: false }); await sheet.applyCellFormat(range(500), { bold: true });
    }
    const documents = plain(await api.getSyncDocuments(''));
    await assert.rejects(sheet.pasteMinuteRange(destination, { previewToken: preview.token }), /changed/);
    assert.equal((await api.getMinuteEntry(day, 500)).text, 'Original');
    assert.equal(await api.getMinuteEntry(destination.dateKey, 500), null);
    assert.deepEqual(plain(await api.getSyncDocuments('')), documents);
    assert.equal(sheet.getSpreadsheetClipboard().mode, 'cut');
  }
});

test('Paste confirmation is tied to the reviewed destination and clipboard, including destination ABA edits', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await save(api, 100, 'Source'); await save(api, 200, 'Destination');
  await sheet.cutMinuteRange(range(100));
  const destination = { dateKey: day, startMinute: 200 };
  const preview = await sheet.prepareMinutePaste(destination);
  await save(api, 200, 'New destination'); await save(api, 200, 'Destination');
  await assert.rejects(sheet.pasteMinuteRange(destination, { previewToken: preview.token }), /changed/);
  assert.equal((await api.getMinuteEntry(day, 100)).text, 'Source');
  assert.equal((await api.getMinuteEntry(day, 200)).text, 'Destination');
  const old = await sheet.prepareMinutePaste(destination);
  await sheet.copyMinuteRange(range(200));
  await assert.rejects(sheet.pasteMinuteRange(destination, { previewToken: old.token }), /clipboard or destination changed/);
});

test('a destination write failure rolls back a cross-day move, ledger documents and both outboxes', async (t) => {
  const { api, sheet, sqlite } = harness(t); await api.initializeDatabase();
  await save(api, 100, 'A'); await save(api, 101, 'B');
  await sheet.cutMinuteRange(range(100, 101));
  const destination = { dateKey: '2026-10-26', startMinute: 200 };
  const preview = await sheet.prepareMinutePaste(destination);
  sqlite.exec(`CREATE TRIGGER reject_paste_format BEFORE INSERT ON ledger_documents
    WHEN NEW.key = 'category:minuteFormat:2026-10-26:201' BEGIN SELECT RAISE(ABORT, 'injected paste failure'); END;`);
  const before = plain(await api.getSyncDocuments(''));
  const outbox = plain(sqlite.prepare('SELECT * FROM sync_outbox ORDER BY date_key').all());
  const links = plain(await api.getPendingInlineMinuteLinks());
  await assert.rejects(sheet.pasteMinuteRange(destination, { previewToken: preview.token }), /injected paste failure/);
  assert.equal((await api.getMinuteEntry(day, 100)).text, 'A');
  assert.equal((await api.getMinuteEntry(day, 101)).text, 'B');
  assert.equal(await api.getMinuteEntry(destination.dateKey, 200), null);
  assert.deepEqual(plain(await api.getSyncDocuments('')), before);
  assert.deepEqual(plain(sqlite.prepare('SELECT * FROM sync_outbox ORDER BY date_key').all()), outbox);
  assert.deepEqual(plain(await api.getPendingInlineMinuteLinks()), links);
  assert.equal(sheet.getSpreadsheetClipboard().mode, 'cut');
});

test('Paste rejects day overflow and invalid civil dates before touching the source or destination', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await save(api, 100, 'Source'); await sheet.cutMinuteRange(range(100, 101));
  await assert.rejects(sheet.prepareMinutePaste({ dateKey: '2026-10-26', startMinute: 1439 }), /valid minute range/);
  await assert.rejects(sheet.pasteMinuteRange({ dateKey: '2026-02-30', startMinute: 0 }), /valid minute range/);
  assert.equal((await api.getMinuteEntry(day, 100)).text, 'Source');
  assert.equal(sheet.getSpreadsheetClipboard().count, 2);
  sheet.clearSpreadsheetClipboard();
  await sheet.copyMinuteRange(range(900));
  assert.equal(sheet.getSpreadsheetClipboard().count, 1, 'an empty selection is valid clipboard content');
});

test('canceling Cut during a pending Paste rolls back the move instead of deleting its original cells', async (t) => {
  const h = harness(t); const { api, sheet } = h; await api.initializeDatabase();
  await save(api, 100, 'Keep source'); await sheet.cutMinuteRange(range(100));
  const destination = { dateKey: '2026-10-26', startMinute: 100 };
  const preview = await sheet.prepareMinutePaste(destination);
  const before = plain(await api.getSyncDocuments(''));
  h.onRunAsync = async (sql) => {
    if (sql.startsWith('DELETE FROM minute_entries')) { sheet.clearSpreadsheetClipboard(); h.onRunAsync = undefined; }
  };
  await assert.rejects(sheet.pasteMinuteRange(destination, { previewToken: preview.token }), /Paste was canceled/);
  assert.equal((await api.getMinuteEntry(day, 100)).text, 'Keep source');
  assert.equal(await api.getMinuteEntry(destination.dateKey, 100), null);
  assert.deepEqual(plain(await api.getSyncDocuments('')), before);
  assert.equal(sheet.getSpreadsheetClipboard(), null);
});

test('moving one grouped member detaches only that destination cell and synchronized documents converge on another phone', async (t) => {
  const a = harness(t); const b = harness(t);
  await a.api.initializeDatabase(); await b.api.initializeDatabase();
  const color = (await a.load(a.source('services/categories.ts')).listSelectableActivityCategories())[0].id;
  await save(a.api, 100, 'Coffee'); await save(a.api, 101, 'Talk to Mum');
  await a.sheet.groupMinuteRange(range(100, 102), { title: 'Make coffee', categoryId: color });
  await a.sheet.applyCellFormat(range(101), { italic: true });
  const groupId = (await a.api.getMinuteEntry(day, 100)).blockId;
  await b.api.mergeSyncDocuments(plain(await a.api.getSyncDocuments('')));
  await a.sheet.cutMinuteRange(range(101));
  await a.sheet.pasteMinuteRange({ dateKey: '2026-10-26', startMinute: 700 });
  assert.equal((await a.api.getMinuteEntry(day, 100)).blockId, groupId);
  assert.equal((await a.api.getMinuteEntry(day, 102)).blockId, groupId);
  const moved = await a.api.getMinuteEntry('2026-10-26', 700);
  assert.equal(moved.text, 'Talk to Mum'); assert.equal(moved.categoryId, color);
  assert.notEqual(moved.blockId, groupId);
  assert.deepEqual(plain((await a.sheet.getDayCellFormats('2026-10-26')).get(700)), { italic: true });
  await b.api.mergeSyncDocuments(plain(await a.api.getSyncDocuments('')));
  assert.equal(await b.api.getMinuteEntry(day, 101), null);
  assert.equal((await b.api.getMinuteEntry('2026-10-26', 700)).text, 'Talk to Mum');
  assert.deepEqual(plain([...(await b.sheet.getDayCellFormats('2026-10-26'))]), plain([...(await a.sheet.getDayCellFormats('2026-10-26'))]));
});

test('format-only blank cells do not record time and pass the released encrypted-ledger whitelist', async (t) => {
  const a = harness(t); const b = harness(t);
  await a.api.initializeDatabase(); await b.api.initializeDatabase();
  await a.sheet.applyCellFormat(range(30, 32), { bold: true, italic: true, textColor: '#aabbcc' });
  assert.equal((await a.api.getDayEntries(day)).length, 0);
  assert.equal((await a.api.getCategoryTimeTotals(day, day)).length, 0);
  const docs = await a.api.getSyncDocuments('category:minuteFormat:');
  assert.equal(docs.length, 3);
  const codec = a.load(a.source('sync/codec.ts'));
  codec.validateBatch({ version: 1, id: 'format_batch', documents: plain(docs) });
  await b.api.mergeSyncDocuments(plain(docs));
  assert.deepEqual(plain((await b.sheet.getDayCellFormats(day)).get(31)), { bold: true, italic: true, textColor: '#AABBCC' });
  assert.equal((await b.api.getDayEntries(day)).length, 0);
  const categories = b.load(b.source('services/categories.ts'));
  const listed = await categories.listCategories();
  assert.ok(listed.length >= 9, 'format metadata alone must not prevent default activity seeding');
  assert.equal(listed.some((item) => item.kind === 'minuteFormat'), false);
});

test('typing Undo flushes the latest raw draft, restores it, and invalidates Redo after a new edit', async (t) => {
  const { api, sheet, inline } = harness(t); await api.initializeDatabase();
  await save(api, 60, 'Original'); activate(inline, 60, 'Original');
  sheet.editInlineMinute(day, 60, { text: 'First ' });
  sheet.editInlineMinute(day, 60, { text: 'Latest thought  ' });
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 60)).text, 'Original');
  assert.equal(inline.inlineMinuteDrafts.get(day, 60).text, 'Original');
  await sheet.redoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 60)).text, 'Latest thought');
  assert.equal(inline.inlineMinuteDrafts.get(day, 60).text, 'Latest thought  ');
  await sheet.undoSpreadsheetEdit();
  sheet.editInlineMinute(day, 60, { text: 'New branch' });
  assert.equal(sheet.spreadsheetEditor.snapshot().canRedo, false);
  await inline.flushInlineMinutes();
  assert.equal((await api.getMinuteEntry(day, 60)).text, 'New branch');
});

test('repeated typing and Undo on a planned-but-unrecorded minute never invents a recorded plan', async (t) => {
  const { api, sheet, inline } = harness(t); await api.initializeDatabase();
  activate(inline, 75, 'Planned title');
  sheet.editInlineMinute(day, 75, { text: 'What happened' });
  await sheet.undoSpreadsheetEdit();
  assert.equal(await api.getMinuteEntry(day, 75), null);
  assert.equal(inline.inlineMinuteDrafts.get(day, 75).text, 'Planned title');
  sheet.editInlineMinute(day, 75, { text: 'Another actual' });
  await sheet.undoSpreadsheetEdit();
  assert.equal(await api.getMinuteEntry(day, 75), null);
});

test('fill copies content, activity color and format; Undo restores blank and occupied cells without touching another date', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await save(api, 100, 'Source', 'work'); await save(api, 101, 'Keep old note', 'study'); await save(api, 103, 'Outside');
  await api.saveMinuteEntry({ dateKey: '2026-10-26', minuteIndex: 101, text: 'Tomorrow', categoryId: 'family' });
  await sheet.applyCellFormat(range(100), { bold: true, textColor: '#551122' });
  await sheet.applyCellFormat(range(102), { italic: true });
  await sheet.fillMinuteRange(range(100, 102), 100);
  const entries = (await api.getDayEntries(day)).filter((entry) => entry.minuteIndex <= 102);
  assert.equal(entries.length, 3);
  assert.equal(new Set(entries.map((entry) => entry.blockId)).size, 1, 'fill keeps the original source block ownership');
  assert.ok(entries.every((entry) => entry.text === 'Source' && entry.categoryId === 'work'));
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(102)), { bold: true, textColor: '#551122' });
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 101)).text, 'Keep old note');
  assert.equal(await api.getMinuteEntry(day, 102), null);
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(102)), { italic: true });
  assert.equal((await api.getMinuteEntry(day, 103)).text, 'Outside');
  assert.equal((await api.getMinuteEntry('2026-10-26', 101)).text, 'Tomorrow');
  await sheet.redoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 102)).text, 'Source');
});

test('a format write failure rolls back the entire fill, journal and calendar-link queue', async (t) => {
  const { api, sheet, sqlite } = harness(t); await api.initializeDatabase();
  await save(api, 200, 'Source', 'work'); await save(api, 201, 'Original', 'study');
  sqlite.exec(`CREATE TRIGGER reject_sheet_format BEFORE INSERT ON ledger_documents
    WHEN NEW.key = 'category:minuteFormat:2026-10-25:201' BEGIN SELECT RAISE(ABORT, 'injected format failure'); END;`);
  const before = plain(await api.getSyncDocuments(''));
  await assert.rejects(sheet.fillMinuteRange(range(200, 202), 200), /injected format failure/);
  assert.equal((await api.getMinuteEntry(day, 201)).text, 'Original');
  assert.equal(await api.getMinuteEntry(day, 202), null);
  assert.deepEqual(plain(await api.getSyncDocuments('')), before);
  assert.equal((await api.getPendingInlineMinuteLinks()).length, 0);
});

test('drag Auto fill copies the current 17:19 anchor downward and upward without changing its activity color', async (t) => {
  for (const selection of [
    { direction: 'downward', start: 1039, end: 1042, occupied: 1040 },
    { direction: 'upward', start: 1036, end: 1039, occupied: 1037 },
  ]) {
    const { api, sheet, inline } = harness(t);
    await api.initializeDatabase();
    await save(api, 1039, 'Previous anchor text', 'work');
    await save(api, selection.occupied, 'Keep this separate thought', 'family');
    await save(api, 1043, 'Outside the selection', 'study');
    activate(inline, 1039, 'Previous anchor text', 'work');
    sheet.editInlineMinute(day, 1039, { text: 'Read Codex' });
    assert.equal((await api.getMinuteEntry(day, 1039)).text, 'Previous anchor text',
      `${selection.direction}: the newest anchor text starts as an uncommitted draft`);

    // The original 17:19 source remains fixed even when the selected range is
    // normalized to 17:16Ã¢â‚¬â€œ17:19 after dragging upward. No color choice is supplied.
    await sheet.fillMinuteRange(range(selection.start, selection.end), 1039);
    const filled = (await api.getDayEntries(day)).filter((entry) =>
      entry.minuteIndex >= selection.start && entry.minuteIndex <= selection.end);
    assert.equal(filled.length, 4, selection.direction);
    assert.ok(filled.every((entry) => entry.text === 'Read Codex'), selection.direction);
    assert.ok(filled.every((entry) => entry.categoryId === 'work'),
      `${selection.direction}: Auto fill keeps the anchor activity without requesting a new color`);
    assert.equal((await api.getMinuteEntry(day, 1043)).text, 'Outside the selection');

    await sheet.undoSpreadsheetEdit();
    for (let minute = selection.start; minute <= selection.end; minute += 1) {
      const restored = await api.getMinuteEntry(day, minute);
      if (minute === 1039) {
        assert.equal(restored.text, 'Read Codex', 'Undoing the fill retains the separately committed anchor edit');
        assert.equal(restored.categoryId, 'work');
      } else if (minute === selection.occupied) {
        assert.equal(restored.text, 'Keep this separate thought');
        assert.equal(restored.categoryId, 'family');
      } else {
        assert.equal(restored, null, `${selection.direction}: minute ${minute} is blank again`);
      }
    }
  }
});

test('an explicit Google color fills source notes and formats, preserving legacy two-argument behavior and Undo', async (t) => {
  const device = harness(t); const { api, sheet } = device;
  await api.initializeDatabase();
  const categories = device.load(device.source('services/categories.ts'));
  await categories.listCategories();
  await api.putSyncDocument('category:legacy', { id: 'legacy', name: 'Old color', color: '#112233' });
  await save(api, 220, 'Make coffee', 'legacy'); await save(api, 221, 'Original note', 'study');
  await save(api, 223, 'Outside range', 'family');
  await sheet.applyCellFormat(range(220), { bold: true, textColor: '#551122' });
  await assert.rejects(sheet.fillMinuteRange(range(220, 222), 220, 'legacy'), /Google Calendar color/);
  assert.equal((await api.getMinuteEntry(day, 221)).text, 'Original note');
  await sheet.fillMinuteRange(range(220, 222), 220, 'prayer');
  const filled = (await api.getDayEntries(day)).filter((entry) => entry.minuteIndex >= 220 && entry.minuteIndex <= 222);
  assert.equal(filled.length, 3);
  assert.ok(filled.every((entry) => entry.text === 'Make coffee' && entry.categoryId === 'prayer'));
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(222)), { bold: true, textColor: '#551122' });
  assert.equal((await api.getMinuteEntry(day, 223)).text, 'Outside range');
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 220)).categoryId, 'legacy');
  assert.equal((await api.getMinuteEntry(day, 221)).text, 'Original note');
  assert.equal(await api.getMinuteEntry(day, 222), null);
  await sheet.fillMinuteRange(range(220, 222), 220);
  assert.ok((await api.getDayEntries(day)).filter((entry) => entry.minuteIndex <= 222)
    .every((entry) => entry.categoryId === 'legacy'), 'existing callers still copy the saved source color');
});

test('an explicit Google color on an empty fill source retains notes and records color-only blank minutes', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await save(api, 231, 'Keep this thought', 'family');
  await sheet.applyCellFormat(range(230), { italic: true });
  await sheet.fillMinuteRange(range(230, 232), 230, 'prayer');
  const filled = await api.getDayEntries(day);
  assert.deepEqual(filled.map((entry) => entry.text), ['', 'Keep this thought', '']);
  assert.ok(filled.every((entry) => entry.categoryId === 'prayer'));
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(232)), { italic: true });
  await sheet.undoSpreadsheetEdit();
  assert.equal(await api.getMinuteEntry(day, 230), null);
  assert.equal((await api.getMinuteEntry(day, 231)).text, 'Keep this thought');
  assert.equal((await api.getMinuteEntry(day, 231)).categoryId, 'family');
  assert.equal(await api.getMinuteEntry(day, 232), null);
  await api.saveMinuteRange({ dateKey: day, startMinute: 230, durationMinutes: 1,
    text: '', categoryId: 'family', allowEmptyText: true });
  await sheet.fillMinuteRange(range(230, 232), 230, 'prayer');
  assert.deepEqual((await api.getDayEntries(day)).map((entry) => entry.text), ['', 'Keep this thought', ''],
    'an explicitly colored but empty source also preserves occupied target notes');
});

test('grouping requires a selectable Google color without changing historical notes or Undo', async (t) => {
  const device = harness(t); const { api, sheet } = device; await api.initializeDatabase();
  await device.load(device.source('services/categories.ts')).listCategories();
  await api.putSyncDocument('category:legacy', { id: 'legacy', name: 'Historical color', color: '#112233' });
  await save(api, 240, 'Keep original note', 'legacy');
  await assert.rejects(sheet.groupMinuteRange(range(240, 242), { title: 'New activity', categoryId: 'legacy' }),
    /Google Calendar color/);
  assert.equal((await api.getMinuteEntry(day, 240)).text, 'Keep original note');
  assert.equal((await api.getMinuteEntry(day, 240)).categoryId, 'legacy');
  assert.equal(await api.getMinuteEntry(day, 241), null);
  await sheet.groupMinuteRange(range(240, 242), { title: 'New activity', categoryId: 'prayer' });
  assert.equal((await api.getMinuteEntry(day, 240)).categoryId, 'prayer');
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 240)).text, 'Keep original note');
  assert.equal((await api.getMinuteEntry(day, 240)).categoryId, 'legacy');
  assert.equal(await api.getMinuteEntry(day, 241), null);
});

test('Undo refuses an externally changed text or source block rather than overwrite it', async (t) => {
  const { api, sheet, inline, sqlite } = harness(t); await api.initializeDatabase();
  await save(api, 300, 'Before'); activate(inline, 300, 'Before');
  sheet.editInlineMinute(day, 300, { text: 'Local edit' });
  await inline.flushInlineMinutes();
  sqlite.prepare('UPDATE minute_entries SET block_id = ? WHERE date_key = ? AND minute_index = ?')
    .run('externally-rebound-source', day, 300);
  await assert.rejects(sheet.undoSpreadsheetEdit(), /selected minute changed/i);
  assert.equal((await api.getMinuteEntry(day, 300)).text, 'Local edit');
  assert.equal((await api.getMinuteEntry(day, 300)).blockId, 'externally-rebound-source');
});

test('clear and Undo restore text and formats, while formatting an empty source fills only formatting', async (t) => {
  const { api, sheet, inline, linkCalls } = harness(t); await api.initializeDatabase();
  await save(api, 400, 'Retain');
  await sheet.applyCellFormat(range(401), { italic: true });
  await sheet.fillMinuteRange(range(400, 402), 401);
  assert.equal((await api.getMinuteEntry(day, 400)).text, 'Retain');
  assert.equal(await api.getMinuteEntry(day, 402), null);
  await sheet.clearMinuteRange(range(400, 402));
  assert.equal((await api.getDayEntries(day)).length, 0);
  assert.equal((await sheet.getDayCellFormats(day)).size, 0);
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 400)).text, 'Retain');
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(400)), { italic: true });
  await inline.flushInlineMinutes();
  await inline.retryInlineMinuteLinks();
  assert.ok(linkCalls.length > 0);
  assert.ok(linkCalls.every((args) => args[1] === null), 'sheet commands use ordinary permission-gated linking, never select a new source occurrence');
});

test('Clear text preserves group membership, colors and formatting through Undo, Redo and private-ledger replay', async (t) => {
  const a = harness(t); const b = harness(t); await a.api.initializeDatabase(); await b.api.initializeDatabase();
  await save(a.api, 400, 'Read this', 'study'); await save(a.api, 401, 'A different note', 'study');
  await a.sheet.groupMinuteRange(range(400, 402), { title: 'Reading', categoryId: 'study' });
  await a.sheet.colorMinuteRange(range(401), 'family');
  await a.sheet.applyCellFormat(range(400, 402), { bold: true, italic: true, underline: true, textColor: '#123456' });
  const before = await a.api.getDayEntries(day); const blockId = before[0].blockId;
  const formats = plain([...(await a.sheet.getDayCellFormats(day))]);
  activate(a.inline, 400, 'Read this');
  await a.sheet.clearTextMinuteRange(range(400, 403));
  let entries = await a.api.getDayEntries(day);
  assert.deepEqual(entries.map((entry) => [entry.text, entry.categoryId, entry.blockId]),
    [['', 'study', blockId], ['', 'family', blockId], ['', 'study', blockId]]);
  assert.deepEqual(entries.map((entry) => entry.id), before.map((entry) => entry.id));
  assert.equal(await a.api.getMinuteEntry(day, 403), null);
  assert.equal(a.inline.inlineMinuteDrafts.get(day, 400).text, '');
  assert.deepEqual(plain([...(await a.sheet.getDayCellFormats(day))]), formats);
  await a.sheet.undoSpreadsheetEdit();
  assert.deepEqual((await a.api.getDayEntries(day)).map((entry) => entry.text), ['Read this', 'A different note', '']);
  await a.sheet.redoSpreadsheetEdit();
  const documents = plain(await a.api.getSyncDocuments(''));
  await b.api.mergeSyncDocuments(documents);
  assert.deepEqual((await b.api.getDayEntries(day)).map((entry) => [entry.text, entry.categoryId, entry.blockId]),
    [['', 'study', blockId], ['', 'family', blockId], ['', 'study', blockId]]);
  assert.deepEqual(plain([...(await b.sheet.getDayCellFormats(day))]), formats);
});

test('Clear text records a blank override only for supplied displayed-plan minutes and keeps their displayed color', async (t) => {
  const { api, sheet, inline } = harness(t); await api.initializeDatabase();
  await save(api, 500, 'Actual note', 'family');
  await sheet.applyCellFormat(range(501), { underline: true });
  activate(inline, 501, 'Projected plan title', 'study');
  await sheet.clearTextMinuteRange(range(500, 502), [
    { minuteIndex: 500, categoryId: 'study' }, { minuteIndex: 501, categoryId: 'study' },
  ]);
  assert.equal((await api.getMinuteEntry(day, 500)).categoryId, 'family');
  const planOverride = await api.getMinuteEntry(day, 501);
  assert.equal(planOverride.text, ''); assert.equal(planOverride.categoryId, 'study');
  assert.equal(inline.inlineMinuteDrafts.get(day, 501).text, '');
  assert.equal(inline.inlineMinuteDrafts.get(day, 501).keepColor, true);
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(501)), { underline: true });
  assert.equal(await api.getMinuteEntry(day, 502), null);
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 500)).text, 'Actual note');
  assert.equal(await api.getMinuteEntry(day, 501), null);
  assert.equal(inline.inlineMinuteDrafts.get(day, 501).text, 'Projected plan title');
  await sheet.redoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 501)).blockId, planOverride.blockId);
});

test('Clear text on blank raw cells is a no-op and rejects invalid displayed-color fallbacks before writing', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await sheet.clearTextMinuteRange(range(550, 552));
  assert.equal(sheet.spreadsheetEditor.snapshot().canUndo, false);
  assert.equal((await api.getDayEntries(day)).length, 0);
  await assert.rejects(sheet.clearTextMinuteRange(range(550), [{ minuteIndex: 551, categoryId: 'study' }]), /valid displayed minutes/);
  await assert.rejects(sheet.clearTextMinuteRange(range(550), [{ minuteIndex: 550, categoryId: 'missing-color' }]), /color is unavailable/);
  assert.equal((await api.getDayEntries(day)).length, 0);
  assert.equal(sheet.spreadsheetEditor.snapshot().canUndo, false);
});

test('a late native typing callback is retained while a formatting transaction is busy', async (t) => {
  const device = harness(t); const { api, sheet, inline } = device;
  await api.initializeDatabase(); await save(api, 450, 'Before'); activate(inline, 450, 'Before');
  let release; const blocked = new Promise((resolve) => { release = resolve; });
  let reached = false;
  device.onRunAsync = async (sql, params) => {
    if (sql.includes('INSERT INTO ledger_documents') && params[0] === 'category:minuteFormat:2026-10-25:450') {
      reached = true; await blocked;
    }
  };
  const formatting = sheet.applyCellFormat(range(450), { bold: true });
  while (!reached) await setImmediate();
  assert.equal(sheet.spreadsheetEditor.snapshot().busy, true);
  sheet.editInlineMinute(day, 450, { text: 'Late keyboard thought' });
  release(); await formatting; device.onRunAsync = undefined;
  await inline.flushInlineMinutes();
  assert.equal((await api.getMinuteEntry(day, 450)).text, 'Late keyboard thought');
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(450)), { bold: true });
});

test('a failed pending text save blocks a range command until the draft can be saved', async (t) => {
  const { api, sheet, inline, sqlite } = harness(t); await api.initializeDatabase();
  await save(api, 500, 'Before'); activate(inline, 500, 'Before');
  sqlite.exec(`CREATE TRIGGER reject_sheet_text BEFORE INSERT ON minute_entries
    WHEN NEW.minute_index = 500 BEGIN SELECT RAISE(ABORT, 'local write unavailable'); END;`);
  sheet.editInlineMinute(day, 500, { text: 'Pending actual' });
  await assert.rejects(sheet.applyCellFormat(range(500, 501), { bold: true }), /has not saved/i);
  assert.equal((await api.getMinuteEntry(day, 500)).text, 'Before');
  assert.equal((await sheet.getDayCellFormats(day)).size, 0);
  assert.equal(inline.inlineMinuteDrafts.get(day, 500).text, 'Pending actual');
  sqlite.exec('DROP TRIGGER reject_sheet_text');
  await inline.flushInlineMinutes();
  await sheet.applyCellFormat(range(500), { textColor: '#123456' });
  assert.equal((await api.getMinuteEntry(day, 500)).text, 'Pending actual');
});

test('a code-5 Undo failure releases both edit queues and the same pasted cell remains editable', async (t) => {
  const { api, sheet, inline } = harness(t); await api.initializeDatabase();
  await save(api, 100, 'Copied note', 'family'); await sheet.copyMinuteRange(range(100));
  await sheet.pasteMinuteRange({ dateKey: day, startMinute: 200 });
  const apply = api.applySpreadsheetTransaction;
  let injected = false;
  api.applySpreadsheetTransaction = async (...args) => {
    if (!injected) { injected = true; throw Object.assign(new Error('database is locked (code 5)'), { code: 5 }); }
    return apply(...args);
  };
  await assert.rejects(sheet.undoSpreadsheetEdit(), (error) => error.code === 5);
  api.applySpreadsheetTransaction = apply;
  assert.equal(sheet.spreadsheetEditor.snapshot().busy, false);
  assert.equal(sheet.spreadsheetEditor.snapshot().canUndo, true);
  assert.equal((await api.getMinuteEntry(day, 200)).text, 'Copied note');
  activate(inline, 200, 'Copied note', 'family');
  sheet.editInlineMinute(day, 200, { text: 'Edited after the failed Undo' });
  await inline.flushInlineMinutes();
  assert.equal((await api.getMinuteEntry(day, 200)).text, 'Edited after the failed Undo');
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 200)).text, 'Copied note', 'Undo retries the new typing command first');
  await sheet.undoSpreadsheetEdit();
  assert.equal(await api.getMinuteEntry(day, 200), null, 'the original Paste Undo remains available and succeeds');
  assert.equal((await api.getMinuteEntry(day, 100)).text, 'Copied note');
  assert.equal(sheet.spreadsheetEditor.snapshot().busy, false);
});

test('native partial text Cut/Paste preserves each cell fill, style, activity and independent Undo history', async (t) => {
  const { api, sheet, inline } = harness(t); await api.initializeDatabase();
  const sourceText = 'Call Mum to plan doctor appointment'; const destinationText = 'Remember the appointment';
  await save(api, 100, sourceText); await save(api, 200, destinationText);
  await sheet.groupMinuteRange(range(100, 101), { title: 'Family', categoryId: 'family' });
  await sheet.groupMinuteRange(range(200, 201), { title: 'Work', categoryId: 'work' });
  await sheet.applyCellFormat(range(100), { bold: true, textColor: '#123456' });
  await sheet.applyCellFormat(range(200), { italic: true, underline: true, textColor: '#654321' });
  const beforeSource = await api.getMinuteEntry(day, 100); const beforeDestination = await api.getMinuteEntry(day, 200);
  const beforeFormats = plain([...(await sheet.getDayCellFormats(day))]);
  // Native text actions use the ordinary inline change path. Only selected
  // characters cross the system clipboard; sheet metadata is never copied.
  activate(inline, 100, sourceText, 'family'); sheet.editInlineMinute(day, 100, { text: 'Call to plan doctor appointment' });
  await inline.flushInlineMinutes();
  activate(inline, 200, destinationText, 'work'); sheet.editInlineMinute(day, 200, { text: 'Remember Mum the appointment' });
  await inline.flushInlineMinutes();
  assert.equal((await api.getMinuteEntry(day, 100)).text, 'Call to plan doctor appointment');
  assert.equal((await api.getMinuteEntry(day, 200)).text, 'Remember Mum the appointment');
  for (const before of [beforeSource, beforeDestination]) {
    const after = await api.getMinuteEntry(day, before.minuteIndex);
    assert.equal(after.categoryId, before.categoryId); assert.equal(after.blockId, before.blockId);
  }
  assert.deepEqual(plain([...(await sheet.getDayCellFormats(day))]), beforeFormats);
  assert.equal(sheet.getSpreadsheetClipboard(), null, 'native text Copy/Cut must not arm whole-cell Paste');
  await sheet.undoSpreadsheetEdit(); assert.equal((await api.getMinuteEntry(day, 200)).text, destinationText);
  await sheet.undoSpreadsheetEdit(); assert.equal((await api.getMinuteEntry(day, 100)).text, sourceText);
  await sheet.redoSpreadsheetEdit(); await sheet.redoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 200)).text, 'Remember Mum the appointment');
  assert.deepEqual(plain([...(await sheet.getDayCellFormats(day))]), beforeFormats);
});

test('an activity groups distinct minute notes and blank members, retaining identity during inline typing and note clearing', async (t) => {
  const { api, sheet, inline } = harness(t); await api.initializeDatabase();
  await save(api, 600, 'Prepare kettle', 'work'); await save(api, 602, 'Drink tea', 'family');
  await sheet.groupMinuteRange(range(600, 602), { title: 'Breakfast', categoryId: 'physiological' });
  let entries = await api.getDayEntries(day);
  assert.deepEqual(entries.map((entry) => entry.text), ['Prepare kettle', '', 'Drink tea']);
  assert.ok(entries.every((entry) => entry.categoryId === 'physiological'));
  const blockId = entries[0].blockId;
  assert.ok(blockId.startsWith('activity_'));
  assert.ok(entries.every((entry) => entry.blockId === blockId));
  activate(inline, 601, '', 'physiological'); sheet.editInlineMinute(day, 601, { text: 'Pour water' });
  await inline.flushInlineMinutes();
  assert.equal((await api.getMinuteEntry(day, 601)).blockId, blockId);
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 601)).text, '');
  assert.equal((await api.getMinuteEntry(day, 601)).blockId, blockId);
  await sheet.redoSpreadsheetEdit();
  sheet.editInlineMinute(day, 601, { text: '' }); await inline.flushInlineMinutes();
  assert.equal((await api.getMinuteEntry(day, 601)).text, '');
  assert.equal((await api.getMinuteEntry(day, 601)).blockId, blockId);
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 601)).text, 'Pour water');
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 601)).text, '');
  assert.equal((await api.getMinuteEntry(day, 601)).blockId, blockId);
  assert.deepEqual(plain(await sheet.getDayActivityGroups(day)), [{ blockId, dateKey: day,
    startMinute: 600, endMinute: 602, title: 'Breakfast', categoryId: 'physiological' }]);
  assert.equal((await api.getCategoryTimeTotals(day, day)).find((item) => item.categoryId === 'physiological').minutes, 3);
});

test('grouping is undoable, preserves formatting and travels through the released encrypted ledger without becoming a category', async (t) => {
  const a = harness(t); const b = harness(t); await a.api.initializeDatabase(); await b.api.initializeDatabase();
  await save(a.api, 650, 'A thought'); await a.sheet.applyCellFormat(range(650), { italic: true });
  await a.sheet.groupMinuteRange(range(650, 652), { title: 'Reflect', categoryId: 'study' });
  const documents = plain(await a.api.getSyncDocuments(''));
  const codec = a.load(a.source('sync/codec.ts')); codec.validateBatch({ version: 1, id: 'group_batch', documents });
  await b.api.mergeSyncDocuments(documents);
  assert.equal((await b.sheet.getDayActivityGroups(day))[0].title, 'Reflect');
  assert.deepEqual((await b.api.getDayEntries(day)).map((entry) => entry.text), ['A thought', '', '']);
  const categories = b.load(b.source('services/categories.ts'));
  assert.ok((await categories.listCategories()).every((item) => !item.activityGroup));
  await a.sheet.undoSpreadsheetEdit();
  assert.equal((await a.sheet.getDayActivityGroups(day)).length, 0);
  assert.equal((await a.api.getDayEntries(day)).length, 1);
  assert.deepEqual(plain((await a.sheet.getDayCellFormats(day)).get(650)), { italic: true });
  await a.sheet.redoSpreadsheetEdit();
  assert.equal((await a.sheet.getDayActivityGroups(day))[0].title, 'Reflect');
});

test('same-color neighbors stay separate, partial regrouping splits activities, and title-only rename retains identity and queues calendar work', async (t) => {
  const { api, sheet, inline, linkCalls } = harness(t); await api.initializeDatabase();
  await sheet.groupMinuteRange(range(700, 704), { title: 'Study', categoryId: 'study' });
  const originalId = (await api.getMinuteEntry(day, 700)).blockId;
  await save(api, 699, 'Outside before'); await save(api, 705, 'Outside after');
  assert.notEqual((await api.getMinuteEntry(day, 699)).blockId, originalId);
  assert.notEqual((await api.getMinuteEntry(day, 705)).blockId, originalId);
  await sheet.groupMinuteRange(range(701, 703), { title: 'Read paper', categoryId: 'study' });
  let groups = await sheet.getDayActivityGroups(day);
  assert.deepEqual(plain(groups.map((group) => [group.startMinute, group.endMinute, group.title])),
    [[700, 700, 'Study'], [701, 703, 'Read paper'], [704, 704, 'Study']]);
  const middleId = groups[1].blockId;
  await inline.flushInlineMinutes(); await inline.retryInlineMinuteLinks(); const beforeCalls = linkCalls.length;
  await sheet.groupMinuteRange(range(701, 703), { title: 'Read revised paper', categoryId: 'study' });
  await inline.flushInlineMinutes();
  await inline.retryInlineMinuteLinks();
  groups = await sheet.getDayActivityGroups(day);
  assert.equal(groups[1].blockId, middleId); assert.equal(groups[1].title, 'Read revised paper');
  assert.ok(linkCalls.length > beforeCalls, 'renaming only the activity must update its calendar event');
  await sheet.undoSpreadsheetEdit();
  assert.equal((await sheet.getDayActivityGroups(day))[1].title, 'Read paper');
  assert.equal((await sheet.getDayActivityGroups(day))[1].blockId, middleId);
});

test('recoloring one grouped minute preserves its note and activity identity while producing separate color segments', async (t) => {
  const { api, sheet, inline } = harness(t); await api.initializeDatabase();
  await sheet.groupMinuteRange(range(800, 804), { title: 'Sleep', categoryId: 'sleep' });
  const blockId = (await api.getMinuteEntry(day, 800)).blockId;
  activate(inline, 802, '', 'sleep');
  sheet.editInlineMinute(day, 802, { text: 'Bathroom break', categoryId: 'physiological', keepColor: true });
  await inline.flushInlineMinutes();
  assert.equal((await api.getMinuteEntry(day, 802)).blockId, blockId);
  assert.deepEqual((await api.getDayEntries(day)).map((entry) => entry.categoryId),
    ['sleep', 'sleep', 'physiological', 'sleep', 'sleep']);
  assert.deepEqual(plain((await api.getDaySegments(day)).map((group) => [group.startMinute, group.endMinute, group.categoryId])),
    [[800, 804, 'sleep']]);
  assert.deepEqual(plain((await sheet.getDayActivityGroups(day)).map((group) => [group.blockId, group.startMinute, group.endMinute, group.title])),
    [[blockId, 800, 804, 'Sleep']], 'one named event border encloses differently colored minute notes');
  assert.equal((await api.getMinuteEntry(day, 802)).text, 'Bathroom break');
});

test('group metadata and entries commit atomically and group operations reject stale note ownership', async (t) => {
  const device = harness(t); const { api, sheet, sqlite } = device; await api.initializeDatabase();
  await device.load(device.source('services/categories.ts')).listCategories();
  await save(api, 850, 'Keep this');
  sqlite.exec(`CREATE TRIGGER reject_group_label BEFORE INSERT ON ledger_documents
    WHEN NEW.key = 'category:minuteFormat:2026-10-25:851' BEGIN SELECT RAISE(ABORT, 'group label unavailable'); END;`);
  const before = plain(await api.getSyncDocuments(''));
  await assert.rejects(sheet.groupMinuteRange(range(850, 852), { title: 'Group', categoryId: 'work' }), /group label unavailable/);
  assert.deepEqual(plain(await api.getSyncDocuments('')), before);
  assert.equal((await api.getDayEntries(day)).length, 1);
  assert.equal((await api.getMinuteEntry(day, 850)).text, 'Keep this');
  assert.equal((await api.getPendingInlineMinuteLinks()).length, 0);
});

test('clearing a grouped note then immediately recoloring it preserves its blank membership through both Undo steps', async (t) => {
  const { api, sheet, inline } = harness(t); await api.initializeDatabase();
  await save(api, 880, 'Initial note', 'study');
  await sheet.groupMinuteRange(range(880, 882), { title: 'Reading', categoryId: 'study' });
  const blockId = (await api.getMinuteEntry(day, 880)).blockId;
  activate(inline, 880, 'Initial note');
  sheet.editInlineMinute(day, 880, { text: '' });
  sheet.editInlineMinute(day, 880, { categoryId: 'family' });
  await sheet.undoSpreadsheetEdit();
  const blank = await api.getMinuteEntry(day, 880);
  assert.equal(blank.text, ''); assert.equal(blank.categoryId, 'study'); assert.equal(blank.blockId, blockId);
  await sheet.undoSpreadsheetEdit();
  const restored = await api.getMinuteEntry(day, 880);
  assert.equal(restored.text, 'Initial note'); assert.equal(restored.categoryId, 'study'); assert.equal(restored.blockId, blockId);
});

test('blank selections can be copied or cut without recording time; reviewed blank Paste clears a destination and Undo restores it', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await sheet.copyMinuteRange(range(100, 102));
  await save(api, 200, 'Keep until reviewed');
  await assert.rejects(sheet.pasteMinuteRange({ dateKey: day, startMinute: 200 }), /Review the destination/);
  const preview = await sheet.prepareMinutePaste({ dateKey: day, startMinute: 200 });
  await sheet.pasteMinuteRange({ dateKey: day, startMinute: 200 }, { previewToken: preview.token });
  assert.equal((await api.getDayEntries(day)).length, 0);
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 200)).text, 'Keep until reviewed');
  await sheet.cutMinuteRange(range(300, 302));
  await sheet.pasteMinuteRange({ dateKey: '2026-11-02', startMinute: 500 });
  assert.equal((await api.getDayEntries('2026-11-02')).length, 0);
});

test('underline survives Copy, Auto fill, Undo and encrypted-ledger replay', async (t) => {
  const a = harness(t); const b = harness(t); await a.api.initializeDatabase(); await b.api.initializeDatabase();
  await save(a.api, 100, 'Read');
  await a.sheet.applyCellFormat(range(100), { underline: true, bold: true });
  await a.sheet.fillMinuteRange(range(100, 102), 100);
  assert.deepEqual(plain((await a.sheet.getDayCellFormats(day)).get(102)), { bold: true, underline: true });
  await a.sheet.copyMinuteRange(range(100, 102));
  await a.sheet.pasteMinuteRange({ dateKey: '2026-10-26', startMinute: 400 });
  await b.api.mergeSyncDocuments(plain(await a.api.getSyncDocuments('')));
  assert.equal((await b.sheet.getDayCellFormats('2026-10-26')).get(402).underline, true);
  await a.sheet.applyCellFormat(range(100), { underline: false });
  assert.equal((await a.sheet.getDayCellFormats(day)).get(100).underline, undefined);
  await a.sheet.undoSpreadsheetEdit();
  assert.equal((await a.sheet.getDayCellFormats(day)).get(100).underline, true);
});

test('cell color changes preserve every distinct note, style and group membership', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await save(api, 200, 'Boil water'); await save(api, 202, 'Talk to Mum');
  await sheet.groupMinuteRange(range(200, 202), { title: 'Make coffee', categoryId: 'study' });
  const id = (await api.getMinuteEntry(day, 200)).blockId;
  await sheet.applyCellFormat(range(201), { italic: true, underline: true, textColor: '#123456' });
  await sheet.colorMinuteRange(range(200, 202), 'work');
  const entries = await api.getDayEntries(day);
  assert.deepEqual(entries.map((entry) => entry.text), ['Boil water', '', 'Talk to Mum']);
  assert.ok(entries.every((entry) => entry.categoryId === 'work' && entry.blockId === id));
  assert.equal((await sheet.getDayCellFormats(day)).get(201).underline, true);
  await sheet.undoSpreadsheetEdit();
  assert.ok((await api.getDayEntries(day)).every((entry) => entry.categoryId === 'study'));
  await assert.rejects(sheet.colorMinuteRange(range(200, 202), 'not-google'), /Google Calendar color/);
});

test('Ungrouping a middle selection retains minute content and creates distinct remaining event groups, with atomic Undo and sync replay', async (t) => {
  const a = harness(t); const b = harness(t); await a.api.initializeDatabase(); await b.api.initializeDatabase();
  for (const [offset, text] of ['A', 'B', 'Talk to Mum', '', 'E'].entries()) await save(a.api, 300 + offset, text);
  await a.sheet.groupMinuteRange(range(300, 304), { title: 'Make coffee', categoryId: 'study' });
  await a.sheet.applyCellFormat(range(301, 303), { underline: true });
  const original = (await a.api.getMinuteEntry(day, 300)).blockId;
  await a.sheet.ungroupMinuteRange(range(302));
  const groups = await a.sheet.getDayActivityGroups(day);
  assert.deepEqual(plain(groups.map((group) => [group.startMinute, group.endMinute, group.title])), [[300, 301, 'Make coffee'], [303, 304, 'Make coffee']]);
  assert.equal(groups[0].blockId, original); assert.notEqual(groups[1].blockId, original);
  assert.notEqual(groups[0].blockId, groups[1].blockId);
  const removed = await a.api.getMinuteEntry(day, 302);
  assert.equal(removed.text, 'Talk to Mum'); assert.equal(removed.categoryId, 'study');
  assert.equal((await a.sheet.getDayCellFormats(day)).get(302).activityGroup, undefined);
  assert.equal((await a.sheet.getDayCellFormats(day)).get(302).underline, true);
  await b.api.mergeSyncDocuments(plain(await a.api.getSyncDocuments('')));
  assert.deepEqual(plain(await b.sheet.getDayActivityGroups(day)), plain(groups));
  await a.sheet.undoSpreadsheetEdit();
  assert.deepEqual(plain((await a.sheet.getDayActivityGroups(day)).map((group) => [group.blockId, group.startMinute, group.endMinute])), [[original, 300, 304]]);
  await a.sheet.redoSpreadsheetEdit();
  assert.deepEqual((await a.api.getDayEntries(day)).map((entry) => entry.text), ['A', 'B', 'Talk to Mum', '', 'E']);
});

test('Ungrouping blank edge or entire group leaves its time/color and notes recorded without old group labels', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await sheet.groupMinuteRange(range(400, 403), { title: 'Quiet time', categoryId: 'study' });
  await sheet.ungroupMinuteRange(range(400, 401));
  assert.deepEqual(plain((await sheet.getDayActivityGroups(day)).map((group) => [group.startMinute, group.endMinute])), [[402, 403]]);
  assert.equal((await api.getDayEntries(day)).length, 4);
  await sheet.ungroupMinuteRange(range(402, 403));
  assert.equal((await sheet.getDayActivityGroups(day)).length, 0);
  assert.ok((await api.getDayEntries(day)).every((entry) => entry.text === '' && entry.categoryId === 'study'));
});

test('whole activity Move handles own overlap, preserves colored minute notes/styles and named identity, then Undo/Redo restores its range', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  for (const [offset, text] of ['A', 'B', 'C', 'D', 'E'].entries()) await save(api, 500 + offset, text);
  await sheet.groupMinuteRange(range(500, 504), { title: 'Coffee', categoryId: 'study' });
  await sheet.colorMinuteRange(range(502), 'work');
  await sheet.applyCellFormat(range(502), { underline: true, italic: true });
  const group = await sheet.getMovableActivityGroup(day, 502);
  assert.equal(group.startMinute, 500); assert.equal(group.endMinute, 504);
  const preview = await sheet.prepareActivityGroupMove(group, { dateKey: day, startMinute: 501 });
  assert.equal(preview.occupiedCount, 0, 'own overlapping cells do not require replacement confirmation');
  await sheet.moveActivityGroup(group, { dateKey: day, startMinute: 501 }, { previewToken: preview.token });
  assert.equal(await api.getMinuteEntry(day, 500), null);
  assert.deepEqual((await api.getDayEntries(day)).map((entry) => entry.text), ['A', 'B', 'C', 'D', 'E']);
  assert.ok((await api.getDayEntries(day)).every((entry) => entry.blockId === group.blockId));
  assert.equal((await api.getMinuteEntry(day, 503)).categoryId, 'work');
  assert.equal((await sheet.getDayCellFormats(day)).get(503).underline, true);
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 500)).text, 'A'); assert.equal(await api.getMinuteEntry(day, 505), null);
  await sheet.redoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 505)).text, 'E');
});

test('cross-day whole-group Move previews occupied cells, commits both dates/outboxes together and converges after Undo/Redo replay', async (t) => {
  const a = harness(t); const b = harness(t); await a.api.initializeDatabase(); await b.api.initializeDatabase();
  await save(a.api, 600, 'Boil'); await save(a.api, 601, 'Pour');
  await a.sheet.groupMinuteRange(range(600, 602), { title: 'Coffee', categoryId: 'study' });
  const group = await a.sheet.getMovableActivityGroup(day, 601);
  const target = { dateKey: '2026-11-05', startMinute: 700 };
  await a.api.saveMinuteEntry({ dateKey: target.dateKey, minuteIndex: 700, text: 'Old', categoryId: 'work' });
  await assert.rejects(a.sheet.moveActivityGroup(group, target), /Review the destination/);
  assert.equal((await a.api.getMinuteEntry(day, 600)).text, 'Boil');
  const preview = await a.sheet.prepareActivityGroupMove(group, target); assert.equal(preview.occupiedCount, 1);
  await a.sheet.moveActivityGroup(group, target, { previewToken: preview.token });
  assert.equal((await a.api.getDayEntries(day)).length, 0);
  assert.deepEqual((await a.api.getDayEntries(target.dateKey)).map((entry) => entry.text), ['Boil', 'Pour', '']);
  assert.equal((await a.sheet.getDayActivityGroups(target.dateKey))[0].blockId, group.blockId);
  assert.ok((await a.api.getPendingInlineMinuteLinks()).some((ticket) => ticket.dateKey === target.dateKey));
  await b.api.mergeSyncDocuments(plain(await a.api.getSyncDocuments('')));
  assert.equal((await b.sheet.getDayActivityGroups(target.dateKey))[0].blockId, group.blockId);
  await a.sheet.undoSpreadsheetEdit();
  assert.equal((await a.api.getMinuteEntry(target.dateKey, 700)).text, 'Old');
  assert.equal((await a.sheet.getDayActivityGroups(day))[0].blockId, group.blockId);
  await a.sheet.redoSpreadsheetEdit();
  await b.api.mergeSyncDocuments(plain(await a.api.getSyncDocuments('')));
  assert.equal((await b.api.getDayEntries(day)).length, 0);
  assert.equal((await b.api.getMinuteEntry(target.dateKey, 701)).text, 'Pour');
});

test('Move rejects stale source/destination revisions, changed membership and day overflow before removing source cells', async (t) => {
  for (const changed of ['source', 'destination', 'membership']) {
    const { api, sheet } = harness(t); await api.initializeDatabase();
    await sheet.groupMinuteRange(range(800, 802), { title: 'Coffee', categoryId: 'study' });
    const group = await sheet.getMovableActivityGroup(day, 801);
    const target = { dateKey: '2026-10-26', startMinute: 100 };
    const preview = await sheet.prepareActivityGroupMove(group, target);
    if (changed === 'source') {
      await sheet.applyCellFormat(range(801), { bold: true }); await sheet.applyCellFormat(range(801), { bold: false });
    } else if (changed === 'destination') {
      await api.saveMinuteEntry({ dateKey: target.dateKey, minuteIndex: 100, text: 'Later', categoryId: 'study' });
      await api.deleteMinuteEntry(target.dateKey, 100);
    } else {
      const entry = await api.getMinuteEntry(day, 800);
      await api.applySpreadsheetCells(day, [{ minuteIndex: 803, entry: { text: '', categoryId: entry.categoryId, blockId: group.blockId },
        format: { activityGroup: { id: group.blockId, title: group.title } } }],
        [{ minuteIndex: 803, entry: null, format: {} }], { textChanged: true, formatChanged: true });
    }
    await assert.rejects(sheet.moveActivityGroup(group, target, { previewToken: preview.token }), /changed/);
    assert.equal((await api.getMinuteEntry(day, 800)).blockId, group.blockId);
    assert.equal(await api.getMinuteEntry(target.dateKey, 100), null);
    await assert.rejects(sheet.prepareActivityGroupMove(await sheet.getMovableActivityGroup(day, 801),
      { dateKey: target.dateKey, startMinute: 1439 }), /valid minute range/);
  }
});


test('Reset cells removes the selected dental edge completely, keeps source event identity and restores notes/styles with Undo', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  const block = 'legacy_dental';
  await api.replaceProjectedMinutes({ blockId: block, previousDate: day, previousStart: 530, previousEnd: 542,
    activityTitle: 'Dental appointment', entries: Array.from({length:13},(_,i)=>({dateKey:day,minuteIndex:530+i,
      text:i===5?'Discuss procedure':'',categoryId:'work'})) });
  await api.saveSyncBinding({segmentKey:`${day}:${block}:530-542`,blockId:block,dateKey:day,calendarId:'cal',eventId:'dental'});
  await sheet.applyCellFormat(range(532),{bold:true,textColor:'#123456'});
  await save(api,529,'Unrelated note','work'); const unrelated=plain(await api.getMinuteEntry(day,529));
  assert.notEqual(unrelated.blockId,block,'a same-color adjacent note cannot absorb a named source event');
  await sheet.resetMinuteCells(range(530,532));
  for(let m=530;m<=532;m++){assert.equal(await api.getMinuteEntry(day,m),null);assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(m)),{noFill:true});}
  const groups=await sheet.getDayActivityGroups(day);
  assert.deepEqual(plain(groups.map(g=>[g.blockId,g.startMinute,g.endMinute,g.title])),[[block,533,542,'Dental appointment']]);
  assert.equal((await api.getMinuteEntry(day,535)).text,'Discuss procedure');
  assert.deepEqual(plain(await api.getMinuteEntry(day,529)),unrelated);
  assert.equal((await api.getSyncBindings(day))[0].eventId,'dental','local edits retain the exact binding for authorized retiming');
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day,532)).source,'imported');
  assert.equal((await sheet.getDayCellFormats(day)).get(532).bold,true);
  assert.deepEqual(plain((await sheet.getDayActivityGroups(day)).map(g=>[g.blockId,g.startMinute,g.endMinute])),[[block,530,542]]);
  await sheet.redoSpreadsheetEdit();assert.equal(await api.getMinuteEntry(day,530),null);
});

test('Reset in the middle splits a named legacy event into two borders, retaining its first source ID and replaying atomically', async (t) => {
  const a=harness(t),b=harness(t);await a.api.initializeDatabase();await b.api.initializeDatabase();
  const block='legacy_dental';
  await a.api.replaceProjectedMinutes({blockId:block,previousDate:day,previousStart:530,previousEnd:542,activityTitle:'Dentist',
    entries:Array.from({length:13},(_,i)=>({dateKey:day,minuteIndex:530+i,text:i===10?'Rinse':'',categoryId:'work'}))});
  await a.sheet.resetMinuteCells(range(535,537));
  const groups=await a.sheet.getDayActivityGroups(day);assert.equal(groups.length,2);
  assert.equal(groups[0].blockId,block);assert.match(groups[1].blockId,/^activity_/);
  assert.deepEqual(plain(groups.map(g=>[g.startMinute,g.endMinute,g.title])),[[530,534,'Dentist'],[538,542,'Dentist']]);
  assert.equal((await a.api.getMinuteEntry(day,540)).text,'Rinse');
  await b.api.mergeSyncDocuments(plain(await a.api.getSyncDocuments('')));
  assert.deepEqual(plain(await b.sheet.getDayActivityGroups(day)),plain(groups));
  assert.equal(await b.api.getMinuteEntry(day,536),null);assert.deepEqual(plain((await b.sheet.getDayCellFormats(day)).get(536)),{noFill:true});
  await a.sheet.undoSpreadsheetEdit();assert.ok((await a.api.getDayEntries(day)).every(e=>e.blockId===block));
});

test('a blank or single-minute border owns its title independently, and redefining it splits remainders while preserving source ID', async (t) => {
  const {api,sheet}=harness(t);await api.initializeDatabase();
  await sheet.groupMinuteRange(range(100),{title:'Dentist',categoryId:'work'});
  const first=(await api.getMinuteEntry(day,100)).blockId;assert.equal((await api.getMinuteEntry(day,100)).text,'');
  await sheet.groupMinuteRange(range(100,104),{title:'Dentist',categoryId:'work'});
  assert.ok((await api.getDayEntries(day)).every(e=>e.blockId===first));
  const preview=await sheet.prepareExternalMinutePaste('Talk to mum',{dateKey:day,startMinute:102});
  await sheet.pasteExternalMinuteRange('Talk to mum',{dateKey:day,startMinute:102},{previewToken:preview.token});
  await sheet.groupMinuteRange(range(102,103),{title:'New bounds',categoryId:'family'});
  const groups=await sheet.getDayActivityGroups(day);assert.equal(groups.length,3);
  assert.equal((await api.getMinuteEntry(day,102)).blockId,first);assert.equal((await api.getMinuteEntry(day,102)).text,'Talk to mum');
  assert.deepEqual(plain(groups.map(g=>[g.startMinute,g.endMinute,g.title])),[[100,101,'Dentist'],[102,103,'New bounds'],[104,104,'Dentist']]);
  await sheet.undoSpreadsheetEdit();assert.deepEqual(plain((await sheet.getDayActivityGroups(day)).map(g=>[g.blockId,g.startMinute,g.endMinute])),[[first,100,104]]);
});

test('Ungrouping legacy event minutes keeps their note/fill but removes both titles and preserves first remainder identity', async(t)=>{
  const {api,sheet}=harness(t);await api.initializeDatabase();const id='native_event_block';
  await api.replaceProjectedMinutes({blockId:id,previousDate:day,previousStart:700,previousEnd:704,activityTitle:'Dental',
    entries:Array.from({length:5},(_,i)=>({dateKey:day,minuteIndex:700+i,text:i===2?'Discuss appointment':'',categoryId:'work'}))});
  await sheet.ungroupMinuteRange(range(702));const groups=await sheet.getDayActivityGroups(day);
  assert.equal(groups[0].blockId,id);assert.match(groups[1].blockId,/^activity_/);
  const note=await api.getMinuteEntry(day,702);assert.equal(note.text,'Discuss appointment');assert.equal(note.categoryId,'work');assert.match(note.blockId,/^sheet_/);
  const format=(await sheet.getDayCellFormats(day)).get(702);assert.equal(format?.calendarEvent,undefined);assert.equal(format?.activityGroup,undefined);
  await sheet.undoSpreadsheetEdit();assert.equal((await api.getMinuteEntry(day,702)).blockId,id);
});

test('Reset rolls back deleted notes/styles/group splits and their private journal if a later formatting write fails', async(t)=>{
  const {api,sheet,sqlite}=harness(t);await api.initializeDatabase();await sheet.groupMinuteRange(range(530,534),{title:'Dental',categoryId:'work'});
  await sheet.applyCellFormat(range(532),{underline:true});const before=plain(await api.getSyncDocuments(''));
  sqlite.exec(`CREATE TRIGGER reject_full_reset BEFORE INSERT ON ledger_documents WHEN NEW.key='category:minuteFormat:${day}:532' BEGIN SELECT RAISE(ABORT,'full Reset failed'); END`);
  await assert.rejects(sheet.resetMinuteCells(range(532)),/full Reset failed/);
  assert.deepEqual(plain(await api.getSyncDocuments('')),before);assert.equal((await api.getDayEntries(day)).length,5);
  sqlite.exec('DROP TRIGGER reject_full_reset');await sheet.resetMinuteCells(range(532));assert.equal(await api.getMinuteEntry(day,532),null);
});


test('Reset00:26 stale fill-only and orphan styling leaves a truly blank unbordered cell with only plan suppression, and Undo restores it',async(t)=>{
 const {api,sheet}=harness(t);await api.initializeDatabase();
 await api.saveMinuteRange({dateKey:day,startMinute:26,durationMinutes:1,text:'',categoryId:'work',allowEmptyText:true});
 await sheet.applyCellFormat(range(26),{bold:true,textColor:'#123456'});await save(api,27,'Unrelated next minute','family');
 const neighbor=plain(await api.getMinuteEntry(day,27));await sheet.resetMinuteCells(range(26));
 assert.equal(await api.getMinuteEntry(day,26),null);assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(26)),{noFill:true});
 assert.equal((await sheet.getDayActivityGroups(day)).length,0);assert.deepEqual(plain(await api.getMinuteEntry(day,27)),neighbor);
 await sheet.undoSpreadsheetEdit();assert.equal((await api.getMinuteEntry(day,26)).text,'');assert.equal((await api.getMinuteEntry(day,26)).categoryId,'work');
 assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(26)),{bold:true,textColor:'#123456'});
 await sheet.redoSpreadsheetEdit();await sheet.applyCellFormat(range(26),{italic:true});
 await sheet.resetMinuteCells(range(26));assert.equal(await api.getMinuteEntry(day,26),null);assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(26)),{noFill:true});
});

test('activity intent survives full Ungroup, partial splits, Undo and private-ledger replay without retiring provider identity early', async (t) => {
  const a = harness(t); const b = harness(t); await a.api.initializeDatabase(); await b.api.initializeDatabase();
  await save(a.api, 900, 'First note'); await save(a.api, 901, 'Second note');
  await a.sheet.groupMinuteRange(range(900, 902), { title: 'Study', categoryId: 'study' });
  const blockId = (await a.api.getMinuteEntry(day, 900)).blockId;
  const projection = { id: 'owned', blockId, state: 'pending', eventId: 'original-event', sourceEventId: 'original-event' };
  await a.api.putSyncDocument('projection:owned', projection);
  const first = await a.api.getActivityEditIntent(blockId);
  assert.equal(first.deleted, false);
  await a.sheet.ungroupMinuteRange(range(901));
  const partial = await a.api.getActivityEditIntent(blockId);
  assert.equal(partial.deleted, false); assert.ok(Date.parse(partial.updatedAt) > Date.parse(first.updatedAt));
  assert.equal(partial.detachedMembers.length, 1);
  await a.sheet.ungroupMinuteRange(range(900));
  const deleted = await a.api.getActivityEditIntent(blockId);
  assert.equal(deleted.deleted, true);
  assert.ok(Date.parse(deleted.updatedAt) > Date.parse(partial.updatedAt));
  assert.equal(deleted.detachedMembers.length, 2);
  assert.deepEqual((await a.api.getDayEntries(day)).map((entry) => entry.text), ['First note', 'Second note', '']);
  assert.deepEqual(plain((await a.api.getSyncDocuments('projection:owned'))[0].value), projection);
  const documents = plain(await a.api.getSyncDocuments(''));
  const codec = a.load(a.source('sync/codec.ts')); codec.validateBatch({ version: 1, id: 'ungroup_intent', documents });
  await b.api.mergeSyncDocuments(documents);
  assert.equal((await b.api.getActivityEditIntent(blockId)).deleted, true);
  assert.equal(await b.api.getActivityLocalUpdatedAt(blockId), Date.parse(deleted.updatedAt));
  assert.equal((await b.sheet.getDayActivityGroups(day)).some((group) => group.blockId === blockId), false);
  await a.sheet.undoSpreadsheetEdit();
  const restored = await a.api.getActivityEditIntent(blockId);
  assert.equal(restored.deleted, false); assert.ok(Date.parse(restored.updatedAt) > Date.parse(deleted.updatedAt));
  await a.sheet.redoSpreadsheetEdit(); assert.equal((await a.api.getActivityEditIntent(blockId)).deleted, true);
});

test('activity intent authority excludes no-ops, provider import-now timestamps and upload acknowledgements', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await save(api, 950, 'Original'); await sheet.groupMinuteRange(range(950), { title: 'Study', categoryId: 'study' });
  const entry = await api.getMinuteEntry(day, 950); const original = plain(await api.getActivityEditIntent(entry.blockId));
  const authority = await api.getActivityLocalUpdatedAt(entry.blockId);
  await api.saveMinuteRange({ dateKey: day, startMinute: 950, durationMinutes: 1, text: 'Original', categoryId: 'study' });
  await sheet.applyCellFormat(range(950), {});
  assert.deepEqual(plain(await api.getActivityEditIntent(entry.blockId)), original);
  assert.equal(await api.getActivityLocalUpdatedAt(entry.blockId), authority);
  const docs = await api.getDocumentsForUpload('google:person', 500); await api.acknowledgeUploaded('google:person', docs);
  assert.equal(await api.getActivityLocalUpdatedAt(entry.blockId), authority);
  const before = await api.getDayEntries(day);
  await api.replaceProjectedMinutes({ blockId: entry.blockId, previousDate: day, previousStart: 950, previousEnd: 950,
    expectedEntries: before, expectedActivityTitle: 'Study', expectedActivityEditIntent: original,
    activityTitle: 'Provider title', entries: [{ dateKey: day, minuteIndex: 950, text: 'Provider edit', categoryId: 'study' }] });
  assert.deepEqual(plain(await api.getActivityEditIntent(entry.blockId)), original);
  assert.equal(await api.getActivityLocalUpdatedAt(entry.blockId), authority);
  await api.replaceProjectedMinutes({ blockId: 'provider_only', previousDate: day, previousStart: 960, previousEnd: 960,
    expectedActivityEditIntent: null, activityTitle: 'New source', entries: [{ dateKey: day, minuteIndex: 960, text: 'Imported only', categoryId: 'study' }] });
  assert.equal(await api.getActivityLocalUpdatedAt('provider_only'), null);
  assert.equal(await api.getActivityLocalUpdatedAt('provider_only', [{ dateKey: day, minuteIndex: 960 }]), null);
});

test('source import guards an expected null intent and every later intent revision, while tombstone failure rolls local Ungroup back atomically', async (t) => {
  const { api, sheet, sqlite } = harness(t); await api.initializeDatabase();
  await api.replaceProjectedMinutes({ blockId: 'source_intent', previousDate: day, previousStart: 980, previousEnd: 981,
    expectedActivityEditIntent: null, activityTitle: 'Source', entries: [980, 981].map((minuteIndex) => ({ dateKey: day, minuteIndex, text: 'Keep', categoryId: 'study' })) });
  await sheet.applyCellFormat(range(980), { bold: true });
  const before = await api.getDayEntries(day);
  await assert.rejects(api.replaceProjectedMinutes({ blockId: 'source_intent', previousDate: day, previousStart: 980, previousEnd: 981,
    expectedEntries: before, expectedActivityTitle: 'Source', expectedActivityEditIntent: null, activityTitle: 'Stale import', entries: [] }), /intent changed/);
  const snapshot = await api.getActivityEditIntent('source_intent');
  const stored = { ...plain(snapshot) }; delete stored.revision;
  await api.putSyncDocument('category:minuteFormat:activityEdit:source_intent', stored);
  await assert.rejects(api.replaceProjectedMinutes({ blockId: 'source_intent', previousDate: day, previousStart: 980, previousEnd: 981,
    expectedEntries: before, expectedActivityTitle: 'Source', expectedActivityEditIntent: snapshot, entries: [] }), /intent changed/);
  sqlite.exec(`CREATE TRIGGER reject_activity_tombstone BEFORE INSERT ON ledger_documents
    WHEN NEW.key='category:minuteFormat:activityEdit:source_intent' BEGIN SELECT RAISE(ABORT,'tombstone unavailable'); END;`);
  const documents = plain(await api.getSyncDocuments(''));
  await assert.rejects(sheet.ungroupMinuteRange(range(980, 981)), /tombstone unavailable/);
  assert.deepEqual(plain(await api.getSyncDocuments('')), documents);
  assert.ok((await api.getDayEntries(day)).every((entry) => entry.blockId === 'source_intent'));
});

test('a genuinely newer provider edit restores exact imported-origin Ungroup members without fabricating a local timestamp', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  const blockId = 'source_restore';
  await api.replaceProjectedMinutes({ blockId, previousDate: day, previousStart: 1000, previousEnd: 1002,
    activityTitle: 'Original event', entries: [1000, 1001, 1002].map((minuteIndex) => ({ dateKey: day, minuteIndex, text: `Note ${minuteIndex}`, categoryId: 'study' })) });
  await sheet.ungroupMinuteRange(range(1000, 1002));
  const intent = await api.getActivityEditIntent(blockId);
  assert.equal(intent.deleted, true); assert.equal(intent.detachedMembers.length, 3);
  assert.ok((await api.getDayEntries(day)).every((entry) => entry.source === 'imported'));
  const snapshots = await api.getSpreadsheetCells(range(1000, 1002));
  await api.replaceProjectedMinutes({ blockId, previousDate: day, previousStart: 1000, previousEnd: 1002,
    expectedEntries: [], expectedActivityEditIntent: intent, authoritativeRemoteUpdatedAt: Date.parse(intent.updatedAt) + 10_000,
    expectedFormats: snapshots.map((cell) => ({ dateKey: day, minuteIndex: cell.minuteIndex, format: cell.format, version: cell.version })),
    activityTitle: 'Newest Google title', entries: [1000, 1001, 1002].map((minuteIndex) => ({ dateKey: day, minuteIndex, text: `Google ${minuteIndex}`, categoryId: 'study' })) });
  const restored = await api.getActivityEditIntent(blockId);
  assert.equal(restored.deleted, false); assert.equal(restored.updatedAt, intent.updatedAt); assert.equal(restored.detachedMembers, undefined);
  assert.equal(await api.getActivityLocalUpdatedAt(blockId), Date.parse(intent.updatedAt));
  assert.equal((await sheet.getDayActivityGroups(day))[0].title, 'Newest Google title');
  assert.deepEqual((await api.getDayEntries(day)).map((entry) => entry.text), ['Google 1000', 'Google 1001', 'Google 1002']);
});

test('newer detached notes or a new unrelated border refuse remote restoration and regroup prunes old claims without advancing its clock', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await save(api, 1050, 'First'); await save(api, 1051, 'Second');
  await sheet.groupMinuteRange(range(1050, 1051), { title: 'Study', categoryId: 'study' });
  const blockId = (await api.getMinuteEntry(day, 1050)).blockId;
  await sheet.ungroupMinuteRange(range(1050, 1051));
  let intent = await api.getActivityEditIntent(blockId);
  const remoteTime = Date.parse(intent.updatedAt) + 1000;
  const current = await api.getMinuteEntry(day, 1050);
  await api.mergeSyncDocuments([{ key: `minute:${day}:1050`, revision: `${String(remoteTime + 2000).padStart(16, '0')}:00000000:phone_peer`,
    value: { ...plain(current), text: 'Newer private note', source: 'manual', updatedAt: new Date(remoteTime + 1000).toISOString() } }]);
  const snapshots = await api.getSpreadsheetCells(range(1050, 1051));
  await assert.rejects(api.replaceProjectedMinutes({ blockId, previousDate: day, previousStart: 1050, previousEnd: 1051,
    expectedEntries: [], expectedActivityEditIntent: intent, authoritativeRemoteUpdatedAt: remoteTime,
    expectedFormats: snapshots.map((cell) => ({ dateKey: day, minuteIndex: cell.minuteIndex, format: cell.format, version: cell.version })),
    activityTitle: 'Older Google edit', entries: [1050, 1051].map((minuteIndex) => ({ dateKey: day, minuteIndex, text: 'Remote', categoryId: 'study' })) }), /newer recorded activity/);
  assert.equal((await api.getMinuteEntry(day, 1050)).text, 'Newer private note');
  assert.equal(await api.getActivityLocalUpdatedAt(blockId), remoteTime + 1000);
  await sheet.groupMinuteRange(range(1051), { title: 'Independent activity', categoryId: 'family' });
  const pruned = await api.getActivityEditIntent(blockId);
  assert.equal(pruned.updatedAt, intent.updatedAt);
  assert.equal(pruned.detachedMembers.some((member) => member.minuteIndex === 1051), false);
  intent = pruned;
  const next = await api.getSpreadsheetCells(range(1050, 1051));
  await assert.rejects(api.replaceProjectedMinutes({ blockId, previousDate: day, previousStart: 1050, previousEnd: 1051,
    expectedEntries: [], expectedActivityEditIntent: intent, authoritativeRemoteUpdatedAt: remoteTime + 10_000,
    expectedFormats: next.map((cell) => ({ dateKey: day, minuteIndex: cell.minuteIndex, format: cell.format, version: cell.version })),
    activityTitle: 'Cannot overwrite other activity', entries: [1050, 1051].map((minuteIndex) => ({ dateKey: day, minuteIndex, text: 'Remote', categoryId: 'study' })) }), /another or newer/);
  assert.equal((await api.getMinuteEntry(day, 1050)).text, 'Newer private note');
});

test('calendar authority wins an exact timestamp tie when restoring fully Ungrouped minute claims', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase(); const blockId = 'source_tie';
  await api.replaceProjectedMinutes({ blockId, previousDate: day, previousStart: 1080, previousEnd: 1081,
    activityTitle: 'Source', entries: [1080, 1081].map((minuteIndex) => ({ dateKey: day, minuteIndex, text: 'Original', categoryId: 'study' })) });
  await sheet.ungroupMinuteRange(range(1080, 1081));
  const intent = await api.getActivityEditIntent(blockId); const cells = await api.getSpreadsheetCells(range(1080, 1081));
  await api.replaceProjectedMinutes({ blockId, previousDate: day, previousStart: 1080, previousEnd: 1081,
    expectedEntries: [], expectedActivityEditIntent: intent, authoritativeRemoteUpdatedAt: Date.parse(intent.updatedAt),
    expectedFormats: cells.map((cell) => ({ dateKey: day, minuteIndex: cell.minuteIndex, format: cell.format, version: cell.version })),
    activityTitle: 'Calendar tie wins', entries: [1080, 1081].map((minuteIndex) => ({ dateKey: day, minuteIndex, text: 'Google', categoryId: 'study' })) });
  assert.equal((await sheet.getDayActivityGroups(day))[0].title, 'Calendar tie wins');
  assert.equal((await api.getActivityEditIntent(blockId)).updatedAt, intent.updatedAt);
});

test('a newer calendar restores a partial Ungroup only through complete exact fresh sibling provenance and intent snapshots', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase(); const blockId = 'source_partial_restore';
  const indexes = [1100, 1101, 1102, 1103, 1104];
  await api.replaceProjectedMinutes({ blockId, previousDate: day, previousStart: 1100, previousEnd: 1104,
    activityTitle: 'Original source', entries: indexes.map((minuteIndex) => ({ dateKey: day, minuteIndex, text: `Keep ${minuteIndex}`, categoryId: 'study' })) });
  await sheet.applyCellFormat(range(1104), { italic: true });
  await sheet.ungroupMinuteRange(range(1102));
  const intent = await api.getActivityEditIntent(blockId); const siblingId = (await api.getMinuteEntry(day, 1103)).blockId;
  assert.equal(intent.deleted, false); assert.equal(intent.detachedMembers.length, 1);
  assert.deepEqual(plain(intent.derivedMembers), [1103, 1104].map((minuteIndex) => ({ dateKey: day, minuteIndex, blockId: siblingId })));
  const siblingIntent = await api.getActivityEditIntent(siblingId);
  const latest = Math.max(Date.parse(intent.updatedAt), Date.parse(siblingIntent.updatedAt));
  assert.equal(await api.getActivityLocalUpdatedAt(blockId), latest);
  const originalProjection = { id: 'partial_original', accountId: 'google:owner', calendarId: 'primary', eventId: 'google_original', sourceEventId: 'google_original', blockId, state: 'synced' };
  const siblingProjection = { id: 'partial_sibling', accountId: 'google:owner', calendarId: 'primary', eventId: 'google_sibling', sourceEventId: null, blockId: siblingId, state: 'synced' };
  await api.putSyncDocument('projection:partial_original', originalProjection);
  await api.putSyncDocument('projection:partial_sibling', siblingProjection);
  let expectedProjection = (await api.getSyncDocuments('projection:partial_sibling'))[0];
  const retirement = () => ({ expected: expectedProjection, value: { ...siblingProjection, state: 'pending',
    retirementAuthority: { projectionId: originalProjection.id, eventId: originalProjection.eventId, version: 'google_version_2', updatedAt: new Date(latest).toISOString() } } });
  const cells = await api.getSpreadsheetCells(range(1100, 1104));
  const request = { blockId, previousDate: day, previousStart: 1100, previousEnd: 1104,
    expectedEntries: await api.getEntriesForBlock(blockId), expectedActivityTitle: 'Original source', expectedActivityEditIntent: intent,
    expectedProjectionDocument: (await api.getSyncDocuments('projection:partial_original'))[0],
    authoritativeRemoteUpdatedAt: latest,
    expectedFormats: cells.map((cell) => ({ dateKey: day, minuteIndex: cell.minuteIndex, format: cell.format, version: cell.version })),
    activityTitle: 'Newest Google title', entries: indexes.map((minuteIndex) => ({ dateKey: day, minuteIndex, text: `Google ${minuteIndex}`, categoryId: 'study' })) };
  const before = plain(await api.getSyncDocuments(''));
  await assert.rejects(api.replaceProjectedMinutes(request), /split activity changed|not completely reviewed/);
  assert.deepEqual(plain(await api.getSyncDocuments('')), before);
  await assert.rejects(api.replaceProjectedMinutes({ ...request, expectedDerivedActivityEditIntents: [siblingIntent], entries: request.entries.slice(0, 4) }), /split activity changed|not completely reviewed/);
  assert.deepEqual(plain(await api.getSyncDocuments('')), before);
  await assert.rejects(api.replaceProjectedMinutes({ ...request, expectedDerivedActivityEditIntents: [siblingIntent] }), /every split calendar link/);
  assert.deepEqual(plain(await api.getSyncDocuments('')), before);
  // A same-content projection rewrite still fences a preflighted ownership snapshot.
  await api.putSyncDocument('projection:partial_sibling', siblingProjection);
  const changed = plain(await api.getSyncDocuments(''));
  await assert.rejects(api.replaceProjectedMinutes({ ...request, expectedDerivedActivityEditIntents: [siblingIntent], derivedProjectionRetirements: [retirement()] }), /split calendar link changed/);
  assert.deepEqual(plain(await api.getSyncDocuments('')), changed);
  expectedProjection = (await api.getSyncDocuments('projection:partial_sibling'))[0];
  // A concurrent source conflict choice keeps its identity but changes metadata.
  await api.putSyncDocument('projection:partial_original', { ...originalProjection, title: 'Chosen on another phone' });
  const changedOriginal = plain(await api.getSyncDocuments(''));
  await assert.rejects(api.replaceProjectedMinutes({ ...request, expectedDerivedActivityEditIntents: [siblingIntent], derivedProjectionRetirements: [retirement()] }), /original calendar link changed/);
  assert.deepEqual(plain(await api.getSyncDocuments('')), changedOriginal);
  request.expectedProjectionDocument = (await api.getSyncDocuments('projection:partial_original'))[0];
  await api.replaceProjectedMinutes({ ...request, expectedDerivedActivityEditIntents: [siblingIntent], derivedProjectionRetirements: [retirement()] });
  assert.deepEqual((await api.getDayEntries(day)).map((entry) => entry.blockId), indexes.map(() => blockId));
  assert.equal((await api.getEntriesForBlock(siblingId)).length, 0);
  const next = await api.getActivityEditIntent(blockId); const retired = await api.getActivityEditIntent(siblingId);
  assert.equal(next.deleted, false); assert.equal(next.derivedMembers, undefined); assert.equal(next.detachedMembers, undefined);
  assert.equal(next.updatedAt, intent.updatedAt); assert.equal(retired.deleted, true); assert.equal(retired.updatedAt, siblingIntent.updatedAt);
  const receipt = (await api.getSyncDocuments('projection:partial_sibling'))[0];
  assert.equal(receipt.value.state, 'pending'); assert.equal(receipt.value.eventId, 'google_sibling');
  assert.deepEqual(plain(receipt.value.retirementAuthority), retirement().value.retirementAuthority);
  assert.equal((await sheet.getDayCellFormats(day)).get(1104).italic, true);
  assert.deepEqual(plain((await sheet.getDayActivityGroups(day)).map((group) => group.title)), ['Newest Google title']);
});

test('partial Ungroup restoration refuses newer sibling edits, stale sibling revisions and unrelated regrouped borders', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase(); const blockId = 'source_partial_guard';
  const indexes = [1130, 1131, 1132, 1133, 1134];
  await api.replaceProjectedMinutes({ blockId, previousDate: day, previousStart: 1130, previousEnd: 1134,
    activityTitle: 'Source', entries: indexes.map((minuteIndex) => ({ dateKey: day, minuteIndex, text: 'Keep', categoryId: 'study' })) });
  await sheet.ungroupMinuteRange(range(1132));
  const intent = await api.getActivityEditIntent(blockId); const siblingId = (await api.getMinuteEntry(day, 1133)).blockId;
  const sibling = await api.getActivityEditIntent(siblingId); const remoteTime = Math.max(Date.parse(intent.updatedAt), Date.parse(sibling.updatedAt)) + 1000;
  const makeRequest = async () => ({ blockId, previousDate: day, previousStart: 1130, previousEnd: 1134,
    expectedEntries: await api.getEntriesForBlock(blockId), expectedActivityTitle: 'Source', expectedActivityEditIntent: await api.getActivityEditIntent(blockId),
    authoritativeRemoteUpdatedAt: remoteTime,
    expectedFormats: (await api.getSpreadsheetCells(range(1130, 1134))).map((cell) => ({ dateKey: day, minuteIndex: cell.minuteIndex, format: cell.format, version: cell.version })),
    activityTitle: 'Remote', entries: indexes.map((minuteIndex) => ({ dateKey: day, minuteIndex, text: 'Remote', categoryId: 'study' })) });
  const stored = { ...plain(sibling), updatedAt: new Date(remoteTime + 1000).toISOString() }; delete stored.revision;
  await api.putSyncDocument(`category:minuteFormat:activityEdit:${siblingId}`, stored);
  await assert.rejects(api.replaceProjectedMinutes({ ...await makeRequest(), expectedDerivedActivityEditIntents: [sibling] }), /split activity changed/);
  const newer = await api.getActivityEditIntent(siblingId);
  await assert.rejects(api.replaceProjectedMinutes({ ...await makeRequest(), expectedDerivedActivityEditIntents: [newer] }), /split activity changed/);
  assert.equal(await api.getActivityLocalUpdatedAt(blockId), remoteTime + 1000);
  await sheet.groupMinuteRange(range(1132, 1133), { title: 'Independent border', categoryId: 'family' });
  const pruned = await api.getActivityEditIntent(blockId);
  assert.equal(pruned.updatedAt, intent.updatedAt); assert.equal(pruned.derivedMembers, undefined);
  await assert.rejects(api.replaceProjectedMinutes({ ...await makeRequest(), authoritativeRemoteUpdatedAt: remoteTime + 10_000,
    expectedDerivedActivityEditIntents: [await api.getActivityEditIntent(siblingId)] }), /another or newer/);
  assert.equal((await api.getMinuteEntry(day, 1133)).categoryId, 'family');
});
