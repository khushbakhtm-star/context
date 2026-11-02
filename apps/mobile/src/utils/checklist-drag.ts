import type { ChecklistFlow } from './checklist-flow';

export type ChecklistRowLayout = { y: number; height: number };

/** Dragging changes priority among siblings. Nesting is an explicit action, so
 * passing a child row never unexpectedly reparents the moving task. */
export function checklistDragDestination(flow: ChecklistFlow, id: string,
  layouts: ReadonlyMap<string, ChecklistRowLayout>, visibleIds: ReadonlySet<string>, pointerY: number) {
  const task = flow.items.find((item) => item.id === id);
  if (!task || !Number.isFinite(pointerY)) return null;
  const siblings = flow.items.filter((item) => item.parentId === task.parentId && item.id !== id && visibleIds.has(item.id))
    .map((item) => ({ id: item.id, layout: layouts.get(item.id) }))
    .filter((item): item is { id: string; layout: ChecklistRowLayout } => Boolean(item.layout &&
      Number.isFinite(item.layout.y) && Number.isFinite(item.layout.height) && item.layout.height > 0))
    .sort((left, right) => left.layout.y - right.layout.y);
  return { parentId: task.parentId,
    beforeId: siblings.find(({ layout }) => pointerY < layout.y + layout.height / 2)?.id ?? null };
}
