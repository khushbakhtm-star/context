import * as Clipboard from 'expo-clipboard';

import { getSpreadsheetClipboard, getSpreadsheetClipboardText } from './spreadsheet';

// Keep rich Context copies inside the editor. Plain text on the OS clipboard
// lets a newer Sheets/Excel copy supersede them without inspecting clipboard
// contents on launch, focus, or selection changes.
let systemCopy: { token: string; text: string } | null = null;
let localOnlyCopy: { token: string; previousSystemText: string | null } | null = null;

export async function copySpreadsheetCellsToSystem(): Promise<void> {
  const snapshot = getSpreadsheetClipboard();
  const text = getSpreadsheetClipboardText();
  if (!snapshot) return;
  localOnlyCopy = { token: snapshot.token, previousSystemText: systemCopy?.text ?? null };
  if (text === null) return;
  try {
    const written = await Clipboard.setStringAsync(text, { android: { isSensitive: true } });
    if (written && getSpreadsheetClipboard()?.token === snapshot.token) {
      systemCopy = { token: snapshot.token, text }; localOnlyCopy = null;
    }
  } catch {
    // The local whole-cell snapshot is still available; a failed OS write must
    // not report that the user's already captured cells were lost.
  }
}

export async function readSpreadsheetPasteSource(): Promise<
  { kind: 'internal' } | { kind: 'external'; text: string }
> {
  const token = getSpreadsheetClipboard()?.token ?? null;
  const published = systemCopy;
  const localOnly = localOnlyCopy;
  let text: string;
  try { text = await Clipboard.getStringAsync(); }
  catch { throw new Error('Clipboard access is unavailable. Allow Paste for Context, then try again.'); }
  const snapshot = getSpreadsheetClipboard();
  if ((snapshot?.token ?? null) !== token || systemCopy !== published || localOnlyCopy !== localOnly) {
    throw new Error('The copied cells changed. Choose Paste again.');
  }
  if (snapshot && published?.token === snapshot.token && published.text === text) return { kind: 'internal' };
  // A failed OS export must not turn a known older Context clip into an
  // external text paste, which would drop formatting or the pending Cut.
  if (snapshot && localOnly?.token === snapshot.token &&
      (!text || text === localOnly.previousSystemText)) return { kind: 'internal' };
  if (!text) throw new Error('Copy cells in Google Sheets or Excel, then choose Paste. If asked, allow Paste for Context.');
  return { kind: 'external', text };
}
