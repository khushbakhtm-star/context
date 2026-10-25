import { useEffect } from 'react';
import { AppState } from 'react-native';
import { subscribeInlineMinuteCommits } from '../services/inline-minutes';
import { subscribeSpreadsheetCommits } from '../services/spreadsheet';
import { dateKey } from '../utils/time';
import { drainWearInbox, getWearState, initializeWearBridge, publishWearDay, stopWearBridge,
  subscribeWearCommits } from './service';

export function useWearBridge(ready: boolean, onChanged: (days: string[]) => void) {
  useEffect(() => {
    if (!ready) return;
    const resync = () => {
      if (AppState.currentState !== 'active') return;
      void initializeWearBridge().then(() => {
        if (!getWearState().enabled) return;
        void drainWearInbox(); void publishWearDay(dateKey(new Date())).catch(() => {});
      }).catch(() => {});
    };
    const publishDates = (days: string[]) => {
      if (AppState.currentState !== 'active' || !getWearState().enabled) return;
      for (const day of new Set(days)) void publishWearDay(day).catch(() => {});
    };
    const stopChanges = subscribeWearCommits(onChanged);
    const stopInline = subscribeInlineMinuteCommits((event) => publishDates(event.affectedDates));
    const stopSheet = subscribeSpreadsheetCommits((event) => publishDates(event.affectedDates));
    const app = AppState.addEventListener('change', (state) => { if (state === 'active') resync(); });
    const timer = setInterval(resync, 45_000);
    void initializeWearBridge().catch(() => {});
    return () => { clearInterval(timer); app.remove(); stopChanges(); stopInline(); stopSheet(); stopWearBridge(); };
  }, [ready, onChanged]);
}
