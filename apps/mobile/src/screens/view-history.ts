export type ViewHistoryState = { canUndo: boolean; canRedo: boolean };
export type ViewHistoryControls = { undo: () => void; redo: () => void };

export const EMPTY_VIEW_HISTORY: ViewHistoryState = { canUndo: false, canRedo: false };
