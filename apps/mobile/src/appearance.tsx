import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { getSetting, setSetting } from './data/database';
import {
  darkColors, lightColors, normalizeAppearanceMode, resolveAppearanceMode,
  type AppColors, type AppearanceMode,
} from './theme';

const APPEARANCE_KEY = 'appearance.mode';

type AppTheme = {
  colors: AppColors;
  mode: AppearanceMode;
  resolvedMode: 'light' | 'dark';
  setMode: (mode: AppearanceMode) => void;
  persistenceError: string | null;
};

const AppearanceContext = createContext<AppTheme | null>(null);

export function AppearanceProvider({ ready, children }: { ready: boolean; children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<AppearanceMode>('system');
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const changeEpoch = useRef(0);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const resolvedMode = resolveAppearanceMode(mode, systemScheme);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let current = true;
    const epoch = changeEpoch.current;
    void getSetting<unknown>(APPEARANCE_KEY, 'system').then((stored) => {
      if (current && epoch === changeEpoch.current) setModeState(normalizeAppearanceMode(stored));
    }).catch(() => {
      // Keep the current appearance when its preference cannot be read.
    });
    return () => { current = false; };
  }, [ready]);

  useEffect(() => {
    // Also styles native alerts and pickers, while leaving the phone's own setting unchanged.
    Appearance.setColorScheme(mode === 'system' ? 'auto' : mode);
  }, [mode]);

  const setMode = useCallback((next: AppearanceMode) => {
    changeEpoch.current += 1;
    const epoch = changeEpoch.current;
    const selected = normalizeAppearanceMode(next);
    setModeState(selected);
    setPersistenceError(null);
    if (!ready) return;
    writes.current = writes.current.catch(() => undefined)
      .then(() => setSetting(APPEARANCE_KEY, selected))
      .catch(() => {
        if (mounted.current && epoch === changeEpoch.current) {
          setPersistenceError('Your appearance choice could not be saved. Try again.');
        }
      });
  }, [ready]);

  const value = useMemo<AppTheme>(() => ({
    colors: resolvedMode === 'dark' ? darkColors : lightColors,
    mode, resolvedMode, setMode, persistenceError,
  }), [mode, persistenceError, resolvedMode, setMode]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppTheme() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('useAppTheme must be used inside AppearanceProvider');
  return value;
}
