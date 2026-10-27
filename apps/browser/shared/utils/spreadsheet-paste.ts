import { validateMinuteCellRange, type MinuteCellRange } from './cell-format';
import { isDateKey } from './date-selection';
import { addDays, dateKey } from './time';

export const MAX_SPREADSHEET_PASTE_CHARACTERS = 1024 * 1024;
export const MAX_SPREADSHEET_PASTE_CELLS = 10_000;
export const MAX_SPREADSHEET_PASTE_COLUMNS = 31;
export const MAX_SPREADSHEET_CELL_CHARACTERS = 50_000;
export type SpreadsheetPasteMatrix = { rows: number; columns: number; cells: string[][] };
export type SpreadsheetPasteDestination = { dateKey: string; startMinute: number; endMinute?: number };

/** Spreadsheet clipboard text is TSV, with CSV-style quotes around fields that
 * contain tabs/newlines/quotes. It is data only; formulas are never evaluated. */
export function parseSpreadsheetCells(text: string): SpreadsheetPasteMatrix {
  if (typeof text !== 'string' || !text.length) throw new Error('Copy some spreadsheet cells before pasting.');
  if (text.length > MAX_SPREADSHEET_PASTE_CHARACTERS) throw new Error('Paste at most 1,048,576 characters of spreadsheet text at a time.');
  const cells: string[][] = []; let row: string[] = []; let field = '';
  let quoted = false; let closedQuote = false; let fieldStarted = false; let endedRow = false;
  const append = (value: string) => {
    field += value;
    if (field.length > MAX_SPREADSHEET_CELL_CHARACTERS) throw new Error('A pasted cell exceeds 50,000 characters.');
  };
  const finishField = () => {
    row.push(field); field = ''; closedQuote = false; fieldStarted = false;
    if (row.length > MAX_SPREADSHEET_PASTE_COLUMNS) throw new Error('Paste at most 31 day columns at a time.');
  };
  const finishRow = () => {
    finishField(); cells.push(row); row = [];
    if (cells.length > 1440 || cells.length * cells[0]!.length > MAX_SPREADSHEET_PASTE_CELLS) {
      throw new Error('Paste at most 10,000 cells within one day of minutes.');
    }
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { append('"'); index++; }
        else { quoted = false; closedQuote = true; }
      } else append(char);
      endedRow = false;
      continue;
    }
    if (char === '\t') { finishField(); endedRow = false; continue; }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      finishRow(); endedRow = true; continue;
    }
    if (closedQuote) throw new Error('A quoted spreadsheet cell has unexpected text after its closing quote.');
    if (char === '"' && !fieldStarted) { quoted = true; fieldStarted = true; }
    else { append(char); fieldStarted = true; }
    endedRow = false;
  }
  if (quoted) throw new Error('A quoted spreadsheet cell is incomplete. Copy the cells again.');
  // A single final row separator is an exporter terminator. Earlier empty rows
  // and all trailing tab-delimited fields remain part of the pasted rectangle.
  if (!endedRow) finishRow();
  const columns = cells[0]!.length;
  if (cells.some((value) => value.length !== columns)) throw new Error('Copy a rectangular selection of spreadsheet cells.');
  if (cells.length * columns > MAX_SPREADSHEET_PASTE_CELLS) throw new Error('Paste at most 10,000 cells at a time.');
  return { rows: cells.length, columns, cells };
}

/** Quote empty fields too, so a final blank row/cell round-trips unambiguously
 * without being mistaken for a clipboard export's terminal newline. */
export function serializeSpreadsheetCells(matrix: readonly (readonly string[])[]): string {
  if (!matrix.length || !matrix[0]?.length || matrix.some((row) => row.length !== matrix[0]!.length)) {
    throw new Error('Copy a rectangular selection of spreadsheet cells.');
  }
  const result = matrix.map((row) => row.map((cell) => {
    if (typeof cell !== 'string') throw new Error('Copy valid spreadsheet text cells.');
    return !cell || /[\t\r\n"]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
  }).join('\t')).join('\n');
  parseSpreadsheetCells(result);
  return result;
}

export function spreadsheetPasteRanges(matrix: SpreadsheetPasteMatrix,
  destination: SpreadsheetPasteDestination): MinuteCellRange[] {
  validateMinuteCellRange({ dateKey: destination.dateKey, startMinute: destination.startMinute,
    endMinute: destination.endMinute ?? destination.startMinute });
  if (!isDateKey(destination.dateKey)) throw new Error('Choose a supported calendar date.');
  const rows = matrix.rows === 1 && matrix.columns === 1 && destination.endMinute !== undefined
    ? destination.endMinute - destination.startMinute + 1 : matrix.rows;
  if (destination.startMinute + rows > 1440) throw new Error('The pasted rows extend past midnight. Choose an earlier starting minute.');
  if (rows * matrix.columns > MAX_SPREADSHEET_PASTE_CELLS) throw new Error('Paste at most 10,000 cells at a time.');
  return Array.from({ length: matrix.columns }, (_, column) => {
    const day = dateKey(addDays(destination.dateKey, column));
    if (!isDateKey(day)) throw new Error('The pasted columns extend beyond the supported calendar dates.');
    return { dateKey: day, startMinute: destination.startMinute, endMinute: destination.startMinute + rows - 1 };
  });
}
