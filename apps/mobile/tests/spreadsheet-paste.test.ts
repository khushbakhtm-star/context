import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SPREADSHEET_PASTE_CHARACTERS, parseSpreadsheetCells,
  serializeSpreadsheetCells, spreadsheetPasteRanges } from '../src/utils/spreadsheet-paste';

test('TSV rows are minutes and quoted tabs, Unicode, doubled quotes and multiline fields stay in their cells', () => {
  const matrix = parseSpreadsheetCells('Coffee\t"Talk to Mum\nBook doctor"\r\n"A\tB"\t"قالت ""نعم"" ☕"\r\n');
  assert.deepEqual(matrix, { rows: 2, columns: 2, cells: [
    ['Coffee', 'Talk to Mum\nBook doctor'], ['A\tB', 'قالت "نعم" ☕'],
  ] });
});

test('empty fields, trailing tabs and all but one terminal empty row remain explicit cells', () => {
  assert.deepEqual(parseSpreadsheetCells('a\t\t\nb\t\t\n').cells, [['a', '', ''], ['b', '', '']]);
  assert.deepEqual(parseSpreadsheetCells('a\n\n').cells, [['a'], ['']]);
  assert.deepEqual(parseSpreadsheetCells('\n').cells, [['']]);
  assert.deepEqual(parseSpreadsheetCells('""\n""').cells, [[''], ['']]);
  assert.deepEqual(parseSpreadsheetCells('  a  \r\n"\r\ninside\r\n"').cells, [['  a  '], ['\r\ninside\r\n']]);
});

test('serialization round-trips rectangular snapshots, including blank last rows and literal formula text', () => {
  const samples = ['', '☕', 'Line one\nLine two', '\t', '"a"', 'two\r\nlines', '=SUM(A1:A9)', '  '];
  for (let length = 1; length <= 8; length++) {
    const matrix = Array.from({ length }, (_, row) => Array.from({ length: 3 }, (_, column) => samples[(row + column) % samples.length]!));
    assert.deepEqual(parseSpreadsheetCells(serializeSpreadsheetCells(matrix)).cells, matrix);
  }
  assert.equal(serializeSpreadsheetCells([['']]), '""');
  assert.equal(serializeSpreadsheetCells([['a'], ['']]), 'a\n""');
});

test('malformed, nonrectangular and oversized clipboard input rejects without truncating cells', () => {
  for (const value of ['', '"unclosed', '"closed"extra', 'a\tb\nc']) assert.throws(() => parseSpreadsheetCells(value));
  assert.throws(() => parseSpreadsheetCells('x'.repeat(MAX_SPREADSHEET_PASTE_CHARACTERS + 1)), /1,048,576 characters/);
  assert.throws(() => parseSpreadsheetCells('x'.repeat(50_001)), /50,000/);
  assert.throws(() => parseSpreadsheetCells(Array(32).fill('x').join('\t')), /31 day columns/);
  assert.throws(() => parseSpreadsheetCells(Array(1441).fill('x').join('\n')), /10,000 cells/);
  assert.throws(() => parseSpreadsheetCells(Array(324).fill(Array(31).fill('x').join('\t')).join('\n')), /10,000 cells/);
});

test('columns advance by civil dates through DST and month/year boundaries, with inclusive minute ranges', () => {
  assert.deepEqual(spreadsheetPasteRanges(parseSpreadsheetCells('a\tb\tc\nd\te\tf'), { dateKey: '2026-10-31', startMinute: 1438 }), [
    { dateKey: '2026-10-31', startMinute: 1438, endMinute: 1439 },
    { dateKey: '2026-11-01', startMinute: 1438, endMinute: 1439 },
    { dateKey: '2026-11-02', startMinute: 1438, endMinute: 1439 },
  ]);
  assert.equal(spreadsheetPasteRanges(parseSpreadsheetCells('a\tb'), { dateKey: '2026-12-31', startMinute: 0 })[1]!.dateKey, '2027-01-01');
});

test('a single cell broadcasts into the selected minute range while a matrix keeps its own shape', () => {
  assert.deepEqual(spreadsheetPasteRanges(parseSpreadsheetCells('One note'), { dateKey: '2026-10-27', startMinute: 719, endMinute: 727 }), [
    { dateKey: '2026-10-27', startMinute: 719, endMinute: 727 },
  ]);
  assert.deepEqual(spreadsheetPasteRanges(parseSpreadsheetCells('a\nb'), { dateKey: '2026-10-27', startMinute: 719, endMinute: 727 }), [
    { dateKey: '2026-10-27', startMinute: 719, endMinute: 720 },
  ]);
});

test('minute overflow and unsupported dates reject instead of wrapping into another day', () => {
  assert.throws(() => spreadsheetPasteRanges(parseSpreadsheetCells('a\nb'), { dateKey: '2026-10-27', startMinute: 1439 }), /midnight/);
  assert.throws(() => spreadsheetPasteRanges(parseSpreadsheetCells('a\tb'), { dateKey: '9999-12-31', startMinute: 0 }), /supported calendar/);
  for (const destination of [{ dateKey: '2026-02-30', startMinute: 1 }, { dateKey: '2026-10-27', startMinute: -1 },
    { dateKey: '2026-10-27', startMinute: 10, endMinute: 9 }]) assert.throws(() => spreadsheetPasteRanges(parseSpreadsheetCells('x'), destination));
});
