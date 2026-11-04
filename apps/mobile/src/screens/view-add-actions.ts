export type ViewAddAction = { label: string; run: () => void };
export type ViewAddActionsRef = { current: (() => ViewAddAction[]) | null };
