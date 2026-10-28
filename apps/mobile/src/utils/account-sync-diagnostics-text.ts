import type { AccountSyncDiagnostics, AccountSyncDiagnosticStep } from '../sync/types';

const labels: Record<AccountSyncDiagnosticStep, string> = {
  'ledger-list': 'Ledger file list', 'ledger-local': 'Local ledger checks', 'ledger-read': 'Ledger file download',
  'ledger-decrypt': 'Ledger authentication/decryption', 'ledger-merge': 'Ledger merge',
  'ledger-prepare': 'Ledger upload preparation', 'ledger-encrypt': 'Ledger encryption',
  'ledger-upload': 'Ledger upload', 'ledger-ack': 'Ledger upload acknowledgement',
  'minute-links': 'Minute-link queue', 'activity-links': 'Activity-link preparation',
  'activity-rank': 'Activity priority scan', 'calendar-activity': 'Calendar activity total',
  'calendar-local': 'Local calendar activity read/check',
  'calendar-event-read': 'Calendar API event read', 'calendar-color': 'Calendar display colors',
  'calendar-event-write': 'Calendar API event write',
};
const number = (value: number) => Number.isFinite(value) && value >= 0 ? value : 0;
const seconds = (value: number) => (number(value) / 1000).toFixed(1) + ' s';

/** Only fixed step/backend labels and aggregate numbers enter the details popup. */
export function accountSyncDiagnosticsText(value: AccountSyncDiagnostics | undefined, now: number) {
  if (!value) return '';
  const lines = [`Account synchronization elapsed: ${seconds((value.finishedAt ?? now) - value.startedAt)}${value.finishedAt === undefined ? ' (running)' : ''}.`];
  if (value.active && Object.hasOwn(labels, value.active.step)) {
    lines.push(`Current: ${labels[value.active.step]}, ${seconds(now - value.active.startedAt)} waiting.`);
  }
  for (const row of value.steps) {
    if (Object.hasOwn(labels, row.step)) lines.push(`${labels[row.step]}: ${number(row.calls)} calls, ${seconds(row.elapsedMs)}.`);
  }
  const crypto = value.crypto;
  if (crypto) {
    const backends = { webcrypto: 'WebCrypto', native: 'Android native', portableJs: 'Portable JavaScript' } as const;
    for (const backend of Object.keys(backends) as (keyof typeof backends)[]) {
      const work = crypto.kdfByBackend[backend];
      if (work.calls) lines.push(`Key derivation (${backends[backend]}): ${number(work.calls)} calls, ${seconds(work.elapsedMs)}.`);
    }
    lines.push(`Key queue: ${seconds(crypto.keyQueueMs)}; cache hits: ${number(crypto.cacheHits)}; shared requests: ${number(crypto.coalescedKeys)}.`);
    lines.push(`Encrypt/encode: ${number(crypto.encryptCalls)} calls, ${seconds(crypto.encryptMs)}; decrypt/decode: ${number(crypto.decryptCalls)} calls, ${seconds(crypto.decryptMs)}.`);
  }
  lines.push('Step durations can overlap. Timings contain no event details.');
  return lines.join('\n');
}
