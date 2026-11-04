import { getSetting, setSetting } from './database';
import { createCanvasDocument, readCanvasDocument, type CanvasDocument } from '../utils/canvas';

const DOCUMENT_KEY = 'canvas.document.v1';
const LEGACY_NOTEPAD_KEY = 'notepad.text.v1';
let pending: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation, operation);
  pending = result;
  return result;
}

async function readDocument(): Promise<CanvasDocument> {
  const stored = await getSetting<unknown>(DOCUMENT_KEY, null);
  if (stored !== null) return readCanvasDocument(stored);
  const text = await getSetting<unknown>(LEGACY_NOTEPAD_KEY, '');
  return createCanvasDocument(typeof text === 'string' ? text : '');
}

export function loadCanvasDocument(): Promise<CanvasDocument> {
  return enqueue(readDocument);
}

export function saveCanvasDocument(expected: CanvasDocument, draft: CanvasDocument): Promise<void> {
  return enqueue(async () => {
    const current = await readDocument();
    if (JSON.stringify(current) !== JSON.stringify(readCanvasDocument(expected))) {
      throw new Error('Canvas changed while you were editing. Your draft is still open.');
    }
    await setSetting(DOCUMENT_KEY, readCanvasDocument(draft));
  });
}

