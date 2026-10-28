import { getLedgerCryptoDiagnostics, type LedgerCryptoDiagnostics } from './codec';
import type { AccountSyncDiagnostics, AccountSyncDiagnosticStep } from './types';

export type AccountSyncTrace = {
  measure<T>(step: AccountSyncDiagnosticStep, operation: () => T | Promise<T>): Promise<T>;
  snapshot(): AccountSyncDiagnostics;
  finish(): void;
};

const difference = (after: number, before: number) =>
  Number.isFinite(after) && Number.isFinite(before) ? Math.max(0, after - before) : 0;

/** Local-only timings have no account, event, minute, URL, key or payload fields. */
export function createAccountSyncTrace(notify?: (value: AccountSyncDiagnostics) => void,
  clock: () => number = Date.now, readCrypto: () => LedgerCryptoDiagnostics = getLedgerCryptoDiagnostics): AccountSyncTrace {
  const startedAt = clock();
  const baseline = readCrypto();
  let finishedAt: number | undefined;
  const steps = new Map<AccountSyncDiagnosticStep, { step: AccountSyncDiagnosticStep; calls: number; elapsedMs: number }>();
  const active: { step: AccountSyncDiagnosticStep; startedAt: number }[] = [];
  const snapshot = (): AccountSyncDiagnostics => {
    const current = readCrypto();
    const crypto = { ...current, kdfByBackend: { ...current.kdfByBackend } };
    for (const key of ['keyQueueMs', 'cacheHits', 'coalescedKeys', 'encryptCalls', 'encryptMs', 'decryptCalls', 'decryptMs'] as const) {
      crypto[key] = difference(current[key], baseline[key]);
    }
    for (const backend of ['webcrypto', 'native', 'portableJs'] as const) {
      crypto.kdfByBackend[backend] = {
        calls: difference(current.kdfByBackend[backend].calls, baseline.kdfByBackend[backend].calls),
        elapsedMs: difference(current.kdfByBackend[backend].elapsedMs, baseline.kdfByBackend[backend].elapsedMs),
      };
    }
    return { startedAt, ...(finishedAt === undefined ? {} : { finishedAt }),
      active: active.length ? { ...active.at(-1)! } : null,
      steps: [...steps.values()].map((value) => ({ ...value })), crypto };
  };
  const publish = () => { if (!notify) return; try { notify(snapshot()); } catch { /* Timing observers never change synchronization results. */ } };
  return {
    async measure(step, operation) {
      const frame = { step, startedAt: clock() };
      const total = steps.get(step) ?? { step, calls: 0, elapsedMs: 0 };
      total.calls++; steps.set(step, total); active.push(frame); publish();
      try { return await operation(); }
      finally {
        total.elapsedMs += difference(clock(), frame.startedAt);
        active.splice(active.indexOf(frame), 1); publish();
      }
    },
    snapshot,
    finish() { if (finishedAt === undefined) { finishedAt = clock(); publish(); } },
  };
}
