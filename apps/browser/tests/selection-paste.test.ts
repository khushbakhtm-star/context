import test from 'node:test';
import assert from 'node:assert/strict';
import { pastedChanges } from '../src/ledger';

test('one copied text cell fills the selected rectangle in either drag direction', () => {
  const changes = pastedChanges('Read instructions', '2026-10-28', 782, { day: '2026-10-27', minute: 780 });
  assert.equal(changes.length, 6);
  assert.deepEqual(changes[0], { day: '2026-10-27', minute: 780, text: 'Read instructions' });
  assert.deepEqual(changes.at(-1), { day: '2026-10-28', minute: 782, text: 'Read instructions' });
  assert.throws(() => pastedChanges('x', '2026-10-01', 0, { day: '2026-11-01', minute: 0 }), /31 days/);
  assert.throws(() => pastedChanges('x', '2026-10-01', 0, { day: '2026-10-31', minute: 1439 }), /10,000/);
});
test('a spreadsheet matrix starts at the top-left of the selected destination without changing its shape', () => {
  assert.deepEqual(pastedChanges('A\tB\nC\tD', '2026-10-28', 782, { day: '2026-10-27', minute: 780 }), [
    { day: '2026-10-27', minute: 780, text: 'A' }, { day: '2026-10-28', minute: 780, text: 'B' },
    { day: '2026-10-27', minute: 781, text: 'C' }, { day: '2026-10-28', minute: 781, text: 'D' },
  ]);
});
