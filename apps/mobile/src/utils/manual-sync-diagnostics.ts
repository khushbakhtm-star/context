export type ManualSyncStage = 'saving' | 'accounts' | 'phone-calendars' | 'linked-changes' | 'phone-updates' | 'complete';
export type ManualSyncTiming = { startedAt: number; stageStartedAt: number; stage: ManualSyncStage;
  elapsed: Partial<Record<ManualSyncStage, number>>; finishedAt?: number };

export function createManualSyncTiming(now: number): ManualSyncTiming {
  return { startedAt: now, stageStartedAt: now, stage: 'saving', elapsed: {} };
}

export function advanceManualSyncTiming(timing: ManualSyncTiming, stage: ManualSyncStage, now: number) {
  if (timing.finishedAt !== undefined) return;
  timing.elapsed[timing.stage] = (timing.elapsed[timing.stage] ?? 0) + Math.max(0, now - timing.stageStartedAt);
  timing.stage = stage; timing.stageStartedAt = now;
  if (stage === 'complete') timing.finishedAt = now;
}

export function finishManualSyncTiming(timing: ManualSyncTiming, now: number) {
  if (timing.finishedAt !== undefined) return;
  timing.elapsed[timing.stage] = (timing.elapsed[timing.stage] ?? 0) + Math.max(0, now - timing.stageStartedAt);
  timing.finishedAt = now;
}

export function manualSyncDiagnosticsText(timing: ManualSyncTiming, now: number) {
  const labels: Record<ManualSyncStage, string> = { saving: 'Local save', accounts: 'Account API cycle wait',
    'phone-calendars': 'Phone-calendar list', 'linked-changes': 'Linked-source preflight',
    'phone-updates': 'Local phone-provider update queue', complete: 'Complete' };
  const seconds = (milliseconds: number) => (milliseconds / 1000).toFixed(1) + ' s';
  const end = timing.finishedAt ?? now;
  const lines = [`Manual Sync elapsed: ${seconds(Math.max(0, end - timing.startedAt))}${timing.finishedAt === undefined ? ' (still waiting)' : ''}.`];
  for (const stage of Object.keys(labels) as ManualSyncStage[]) {
    if (stage === 'complete') continue;
    const current = timing.finishedAt === undefined && timing.stage === stage;
    const elapsed = (timing.elapsed[stage] ?? 0) + (current ? Math.max(0, now - timing.stageStartedAt) : 0);
    if (timing.elapsed[stage] !== undefined || current) lines.push(`${labels[stage]}: ${seconds(elapsed)}${current ? ' (current wait)' : ''}.`);
  }
  return lines.join('\n');
}
