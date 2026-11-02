import { checklistRows, type ChecklistTask } from './checklist-flow';

export type SearchScope =
  | { kind: 'calendar'; dates: readonly string[] }
  | { kind: 'priority'; listId: string; hideCompleted?: boolean };

export type PrioritySearchHit = { listId: string; listName: string; task: ChecklistTask };

/** A selected date set is a filter, including an empty set; never fall back to all history. */
export function searchDateKeys(dates: readonly string[]): string[] {
  if (!Array.isArray(dates) || dates.length > 366) throw new Error('Choose at most one year of dates to search.');
  const result = [...new Set(dates)].sort();
  for (const value of result) {
    const date = new Date(`${value}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
      throw new Error('The displayed dates changed. Reopen Search from your view.');
  }
  return result;
}

export function searchPriorityLists(lists: readonly { id: string; name: string; items: readonly ChecklistTask[] }[],
  query: string, scope?: Extract<SearchScope, { kind: 'priority' }>): PrioritySearchHit[] {
  if (scope && !lists.some((list) => list.id === scope.listId))
    throw new Error('This checklist changed. Reopen Priority before searching it.');
  const needle = query.trim().toLocaleLowerCase();
  return lists.filter((list) => !scope || list.id === scope.listId).flatMap((list) =>
    checklistRows({ kind: 'checklistFlow', version: 1, items: [...list.items] }, scope?.hideCompleted)
    .map(({ task }) => task)
    .filter((task) => task.text.trim().length &&
      (!needle || task.text.toLocaleLowerCase().includes(needle) || (!scope && list.name.toLocaleLowerCase().includes(needle))))
    .map((task) => ({ listId: list.id, listName: list.name, task })));
}
