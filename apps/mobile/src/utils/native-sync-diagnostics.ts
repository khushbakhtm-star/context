type MutationKind = 'content' | 'color';
type Acknowledgements = { acknowledged: number; totalMs: number; lastMs: number };
export type NativeCalendarSyncDiagnostics = Record<MutationKind, Acknowledgements>;

/** In-memory transport timings only. Nothing identifies an event or its contents. */
export function createNativeSyncDiagnostics(now: () => number = Date.now) {
  const counts: NativeCalendarSyncDiagnostics = {
    content: { acknowledged: 0, totalMs: 0, lastMs: 0 },
    color: { acknowledged: 0, totalMs: 0, lastMs: 0 },
  };
  return {
    async observe<T>(kind: MutationKind, operation: () => Promise<T>): Promise<T> {
      const started = now();
      const result = await operation();
      const elapsed = Math.max(0, now() - started);
      counts[kind].acknowledged++;
      counts[kind].totalMs += elapsed;
      counts[kind].lastMs = elapsed;
      return result;
    },
    snapshot(): NativeCalendarSyncDiagnostics {
      return { content: { ...counts.content }, color: { ...counts.color } };
    },
  };
}

export function nativeSyncDiagnosticsText(value: NativeCalendarSyncDiagnostics) {
  const seconds = (milliseconds: number) => (milliseconds / 1000).toFixed(1) + ' s';
  return 'Local phone-provider acknowledgements since app start:\n' +
    `Content: ${value.content.acknowledged}; SDK wait ${seconds(value.content.totalMs)}.\n` +
    `Color: ${value.color.acknowledged}; SDK wait ${seconds(value.color.totalMs)}.\n` +
    'These are local calendar-provider acknowledgements, not confirmation of upload to Google’s server.';
}
