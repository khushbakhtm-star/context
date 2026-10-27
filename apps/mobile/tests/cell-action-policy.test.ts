import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeCellSelection } from '../src/utils/cell-action-policy';

test('empty selections expose clipboard actions without text formatting or AutoFill', () => {
  for (const cells of [[{ minuteIndex: 10 }], [{ minuteIndex: 10, text: '' }, { minuteIndex: 11, text: ' \n' }]]) {
    const state = analyzeCellSelection(cells);
    assert.equal(state.kind, 'empty');
    assert.equal(state.sourceMinute, null);
    assert.equal(state.canClear, false);
    assert.equal(state.canFormat, false);
    assert.equal(state.canGroup, false);
    assert.equal(state.canAutoFill, false);
  }
});

test('single populated minutes have formatting and clearing without range-only actions', () => {
  const state = analyzeCellSelection([{ minuteIndex: 39, text: 'Make coffee' }]);
  assert.equal(state.kind, 'single-text');
  assert.equal(state.canClear, true);
  assert.equal(state.canFormat, true);
  assert.equal(state.canAutoFill, false);
  assert.equal(state.canGroup, false);
});

test('one populated cell among blanks is the AutoFill source even when the anchor is blank', () => {
  const state = analyzeCellSelection([
    { minuteIndex: 42, text: '' }, { minuteIndex: 40, text: 'Read Codex answer' }, { minuteIndex: 39 },
  ], 39);
  assert.equal(state.kind, 'uniform-text');
  assert.equal(state.cellCount, 3);
  assert.equal(state.sourceMinute, 40);
  assert.equal(state.canAutoFill, true);
  assert.equal(state.canGroup, true);
});

test('identical notes and optional blanks allow AutoFill with a populated preferred source', () => {
  const cells = [{ minuteIndex: 41, text: 'Read' }, { minuteIndex: 40, text: '' },
    { minuteIndex: 39, text: 'Read' }];
  assert.equal(analyzeCellSelection(cells, 41).sourceMinute, 41);
  assert.equal(analyzeCellSelection(cells, 40).sourceMinute, 39);
  assert.equal(analyzeCellSelection(cells).canAutoFill, true);
  assert.equal(analyzeCellSelection(cells).uniqueTextCount, 1);
});

test('different notes can be grouped but never silently overwritten through AutoFill', () => {
  const state = analyzeCellSelection([{ minuteIndex: 39, text: 'Make coffee' },
    { minuteIndex: 40, text: '' }, { minuteIndex: 41, text: 'Talk to mum' }]);
  assert.equal(state.kind, 'mixed-text');
  assert.equal(state.canAutoFill, false);
  assert.equal(state.canGroup, true);
  assert.equal(state.canClear, true);
  assert.equal(state.canFormat, true);
  assert.equal(analyzeCellSelection([{ minuteIndex: 1, text: 'Read' }, { minuteIndex: 2, text: ' Read' }]).canAutoFill, false,
    'whitespace in a nonblank note is still part of its exact recorded text');
});

test('Ungroup stays available for group members even when their minute notes are blank', () => {
  const state = analyzeCellSelection([{ minuteIndex: 39, groupId: 'activity_coffee', text: '' },
    { minuteIndex: 40, groupId: 'activity_coffee' }, { minuteIndex: 41, groupId: 'activity_other' }]);
  assert.equal(state.kind, 'empty');
  assert.equal(state.canUngroup, true);
  assert.deepEqual(state.groupIds, ['activity_coffee', 'activity_other']);
  assert.equal(state.canFormat, false);
});

test('duplicate draft rows and malformed indices cannot invent a multi-cell selection', () => {
  const state = analyzeCellSelection([{ minuteIndex: 39, text: 'Old' }, { minuteIndex: 39, text: 'New' },
    { minuteIndex: -1, text: 'Invalid' }, { minuteIndex: 1440, text: 'Invalid' }, { minuteIndex: 0.5 }]);
  assert.equal(state.cellCount, 1);
  assert.equal(state.nonEmptyCount, 1);
  assert.equal(state.kind, 'single-text');
  assert.equal(state.canAutoFill, false);
});

test('blank colored or styled cells expose formatting without inventing text actions', () => {
  for (const cell of [{ minuteIndex: 10, text: '', hasFill: true }, { minuteIndex: 10, hasFormatting: true }]) {
    const policy = analyzeCellSelection([cell]);
    assert.equal(policy.canFormat, true); assert.equal(policy.canClear, false);
    assert.equal(policy.canAutoFill, false); assert.equal(policy.canGroup, false);
  }
  assert.equal(analyzeCellSelection([{ minuteIndex: 10 }]).canFormat, false);
});
