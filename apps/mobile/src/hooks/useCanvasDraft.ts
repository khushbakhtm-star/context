import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

const AUTOSAVE_DELAY = 350;

export function useCanvasDraft<T>(read: () => Promise<T>, write: (saved: T, draft: T) => Promise<void>) {
  const [value, setValue] = useState<T | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const buffer = useRef<{ draft: T; saved: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);

  const reload = useCallback(async () => {
    const requested = ++generation.current;
    setLoadFailed(false);
    try {
      const saved = await read();
      if (!alive.current || requested !== generation.current) return;
      buffer.current = { draft: saved, saved };
      setValue(saved);
    } catch {
      if (alive.current && requested === generation.current) setLoadFailed(true);
    }
  }, [read]);

  const flush = useCallback((): Promise<boolean> => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (saving.current) return saving.current;
    const current = buffer.current;
    if (!current || current.draft === current.saved) {
      if (alive.current) setSaveFailed(false);
      return Promise.resolve(true);
    }
    async function saveLatest() {
      if (!current) return;
      while (current.draft !== current.saved) {
        const draft = current.draft;
        await write(current.saved, draft);
        current.saved = draft;
      }
    }
    saving.current = saveLatest().then(
      () => { if (alive.current) setSaveFailed(false); return true; },
      () => { if (alive.current) setSaveFailed(true); return false; },
    ).finally(() => { saving.current = null; });
    return saving.current;
  }, [write]);

  useEffect(() => {
    alive.current = true;
    void reload();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flush();
    });
    return () => {
      alive.current = false;
      generation.current++;
      subscription.remove();
      void flush();
    };
  }, [reload, flush]);

  function update(next: T) {
    if (!buffer.current || buffer.current.draft === next) return;
    buffer.current.draft = next;
    setValue(next);
    if (timer.current !== null) clearTimeout(timer.current);
    if (AppState.currentState === 'active') timer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY);
    else void flush();
  }

  return { value, loadFailed, saveFailed, update, flush, reload,
    latest: () => buffer.current?.draft ?? null };
}
