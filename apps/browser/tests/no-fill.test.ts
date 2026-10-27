import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFromDocument } from '../shared/utils/cell-format';
import { calendarCellColor } from '../shared/utils/calendar-cell-color';
import { emptyLedger, mergeLedger, editCells } from '../src/ledger';

test('phone Reset fill metadata suppresses browser actual/plan fills and survives a browser text edit', () => {
  const format = { key: 'category:minuteFormat:2026-10-27:800', revision: '0001793100000000:00000000:phone_fixture', value: { kind: 'minuteFormat', format: { noFill: true, bold: true, activityGroup: { id: 'activity_fixture', title: 'Coffee' } } } };
  const state = mergeLedger(emptyLedger('browser_fixture'), [format]);
  const edited = editCells(state, [{ day: '2026-10-27', minute: 800, text: 'Keep these words' }]).state;
  const normalized = formatFromDocument(edited.documents.find((doc) => doc.key === format.key)!.value);
  assert.equal(normalized.noFill, true); assert.equal(normalized.bold, true); assert.equal(normalized.activityGroup!.title, 'Coffee');
  assert.equal(calendarCellColor({ hasActual: true, actualColor: '#51B749', groupColor: '#ABCDEF', planColor: '#0B8043', noFill: normalized.noFill }), undefined);
  assert.equal(calendarCellColor({ hasActual: false, planColor: '#0B8043', noFill: normalized.noFill }), undefined);
  assert.equal(edited.documents.find((doc) => doc.key.startsWith('minute:'))!.value!.text, 'Keep these words');
});
