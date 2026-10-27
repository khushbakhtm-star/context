export type CellActionPolicyCell = {
  minuteIndex: number;
  text?: string | null;
  groupId?: string | null;
  hasFill?: boolean;
  hasFormatting?: boolean;
};

export type CellActionPolicy = {
  cellCount: number;
  nonEmptyCount: number;
  uniqueTextCount: number;
  kind: 'empty' | 'single-text' | 'uniform-text' | 'mixed-text';
  sourceMinute: number | null;
  canClear: boolean;
  canAutoFill: boolean;
  canGroup: boolean;
  canFormat: boolean;
  canUngroup: boolean;
  groupIds: string[];
};

/** One descriptor per selected minute, including blanks. The latest duplicate
 * descriptor wins, so a draft can replace its saved row without counting twice. */
export function analyzeCellSelection(cells: readonly CellActionPolicyCell[], preferredSourceMinute?: number): CellActionPolicy {
  const byMinute = new Map<number, CellActionPolicyCell>();
  for (const cell of cells) {
    if (Number.isInteger(cell.minuteIndex) && cell.minuteIndex >= 0 && cell.minuteIndex < 1440) {
      byMinute.set(cell.minuteIndex, cell);
    }
  }
  const selected = [...byMinute.values()].sort((left, right) => left.minuteIndex - right.minuteIndex);
  const populated = selected.filter((cell) => typeof cell.text === 'string' && cell.text.trim().length > 0);
  // Whitespace decides whether a cell is blank, but the actual notes are compared
  // exactly. AutoFill must not silently collapse two different recorded texts.
  const uniqueTexts = new Set(populated.map((cell) => cell.text!));
  const groupIds = [...new Set(selected.flatMap((cell) =>
    typeof cell.groupId === 'string' && cell.groupId.trim() ? [cell.groupId] : []))];
  const source = populated.find((cell) => cell.minuteIndex === preferredSourceMinute) ?? populated[0];
  const multiple = selected.length > 1;
  const hasText = populated.length > 0;
  return {
    cellCount: selected.length,
    nonEmptyCount: populated.length,
    uniqueTextCount: uniqueTexts.size,
    kind: !hasText ? 'empty' : !multiple ? 'single-text' : uniqueTexts.size === 1 ? 'uniform-text' : 'mixed-text',
    sourceMinute: source?.minuteIndex ?? null,
    canClear: hasText,
    canAutoFill: multiple && uniqueTexts.size === 1,
    canGroup: multiple && hasText,
    canFormat: hasText || selected.some((cell) => cell.hasFill || cell.hasFormatting),
    canUngroup: groupIds.length > 0,
    groupIds,
  };
}
