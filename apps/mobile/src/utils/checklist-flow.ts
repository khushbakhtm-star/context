/** Opaque category metadata travels with existing encrypted ledgers without
 * creating an activity category, a minute entry, or a calendar event. */
export const CHECKLIST_FLOW_KEY = 'category:checklistFlow:main';
export const MAX_CHECKLIST_TASKS = 1000;
export const MAX_CHECKLIST_DEPTH = 8;
export const MAX_CHECKLIST_TEXT = 50_000;
export const DEFAULT_CHECKLIST_LIST_ID = 'main';
export const DEFAULT_CHECKLIST_LIST_NAME = 'Priority';
export const MAX_CHECKLIST_LISTS = 100;
export const MAX_CHECKLIST_LIST_NAME = 80;
const MAX_TOTAL_TEXT = 250_000;

export type ChecklistTaskFormat = { bold?: boolean; italic?: boolean; underline?: boolean; textColor?: string };
export type ChecklistTaskSource = { ranges: { dateKey: string; startMinute: number; endMinute: number }[];
  selection?: { start: number; end: number } };
export type ChecklistTask = { id: string; text: string; checked: boolean; parentId: string | null;
  format: ChecklistTaskFormat; source?: ChecklistTaskSource };
export type ChecklistFlow = { kind: 'checklistFlow'; version: 1; items: ChecklistTask[] };
export type ChecklistList = { id: string; name: string; items: ChecklistTask[] };
export type ChecklistCollection = { kind: 'checklistFlow'; version: 2; lists: ChecklistList[] };
export type ChecklistListSummary = { id: string; name: string; taskCount: number };
export type ChecklistChange =
  | { type: 'add'; item: ChecklistTask; afterId?: string }
  | { type: 'edit'; id: string; text?: string; format?: ChecklistTaskFormat }
  | { type: 'check'; id: string; checked: boolean }
  | { type: 'delete'; id: string }
  | { type: 'deleteRow'; id: string }
  | { type: 'reset' }
  | { type: 'move'; id: string; parentId: string | null; beforeId?: string | null }
  | { type: 'moveRelative'; id: string; direction: 'up' | 'down' }
  | { type: 'indent'; id: string }
  | { type: 'outdent'; id: string };

const invalid = () => new Error('The checklist data is invalid. Your saved list has not been replaced.');
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw invalid();
}
function id(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value); }
function format(value: unknown): ChecklistTaskFormat {
  if (!object(value)) throw invalid();
  keys(value, ['bold', 'italic', 'underline', 'textColor']);
  const result: ChecklistTaskFormat = {};
  for (const key of ['bold', 'italic', 'underline'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw invalid();
    if (value[key] === true) result[key] = true;
  }
  if (value.textColor !== undefined) {
    if (typeof value.textColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.textColor)) throw invalid();
    result.textColor = value.textColor.toUpperCase();
  }
  return result;
}
function source(value: unknown): ChecklistTaskSource {
  if (!object(value)) throw invalid();
  keys(value, ['ranges', 'selection']);
  if (!Array.isArray(value.ranges) || !value.ranges.length || value.ranges.length > 31) throw invalid();
  const ranges = value.ranges.map((range) => {
    if (!object(range)) throw invalid();
    keys(range, ['dateKey', 'startMinute', 'endMinute']);
    if (typeof range.dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(range.dateKey)) throw invalid();
    const date = new Date(`${range.dateKey}T12:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== range.dateKey ||
        !Number.isInteger(range.startMinute) || !Number.isInteger(range.endMinute) ||
        Number(range.startMinute) < 0 || Number(range.endMinute) > 1439 || Number(range.endMinute) < Number(range.startMinute)) throw invalid();
    return { dateKey: range.dateKey, startMinute: Number(range.startMinute), endMinute: Number(range.endMinute) };
  });
  const result: ChecklistTaskSource = { ranges };
  if (value.selection !== undefined) {
    if (!object(value.selection)) throw invalid();
    keys(value.selection, ['start', 'end']);
    const { start, end } = value.selection;
    if (ranges.length !== 1 || ranges[0]!.startMinute !== ranges[0]!.endMinute ||
        !Number.isInteger(start) || !Number.isInteger(end) || Number(start) < 0 || Number(end) <= Number(start) ||
        Number(end) > MAX_CHECKLIST_TEXT) throw invalid();
    result.selection = { start: Number(start), end: Number(end) };
  }
  return result;
}

export function emptyChecklistFlow(): ChecklistFlow { return { kind: 'checklistFlow', version: 1, items: [] }; }

// Bound the complete transport value, including minute-source references. This
// keeps a single atomic list below the ledger's small encrypted-upload limit.
function serializedUtf8Bytes(value: unknown) {
  const text = JSON.stringify(value); let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}

/** Invalid network metadata fails closed; never silently turn it into an empty
 * editable list that could overwrite the user's synchronized tasks. */
export function readChecklistFlow(value: unknown): ChecklistFlow {
  if (value === null || value === undefined) return emptyChecklistFlow();
  if (!object(value)) throw invalid();
  keys(value, ['kind', 'version', 'items']);
  if (value.kind !== 'checklistFlow' || value.version !== 1 || !Array.isArray(value.items) || value.items.length > MAX_CHECKLIST_TASKS) throw invalid();
  let total = 0;
  const seen = new Set<string>();
  const ancestors: string[] = [];
  const items: ChecklistTask[] = value.items.map((item) => {
    if (!object(item)) throw invalid();
    keys(item, ['id', 'text', 'checked', 'parentId', 'format', 'source']);
    if (!id(item.id) || seen.has(item.id) || typeof item.text !== 'string' || item.text.length > MAX_CHECKLIST_TEXT ||
        typeof item.checked !== 'boolean' || (item.parentId !== null && !id(item.parentId))) throw invalid();
    total += item.text.length; if (total > MAX_TOTAL_TEXT) throw new Error('The checklist contains too much text. Shorten a task before saving.');
    // A flat preorder makes a parent and all of its descendants one movable
    // block. A parent must still be in the current ancestor chain.
    if (item.parentId === null) ancestors.length = 0;
    else {
      const parent = ancestors.indexOf(item.parentId);
      if (parent < 0) throw invalid();
      ancestors.length = parent + 1;
    }
    if (ancestors.length >= MAX_CHECKLIST_DEPTH) throw new Error(`Checklist tasks can be nested up to ${MAX_CHECKLIST_DEPTH} levels.`);
    const result: ChecklistTask = { id: item.id, text: item.text, checked: item.checked,
      parentId: item.parentId, format: format(item.format) };
    if (item.source !== undefined) result.source = source(item.source);
    seen.add(item.id); ancestors.push(item.id); return result;
  });
  const result: ChecklistFlow = { kind: 'checklistFlow', version: 1, items };
  if (serializedUtf8Bytes(result) > 1024 * 1024) throw new Error('The checklist is too large to synchronize. Shorten a task or remove unused rows.');
  return result;
}

function taskIndex(flow: ChecklistFlow, taskId: string) {
  const index = flow.items.findIndex((task) => task.id === taskId);
  if (index < 0) throw new Error('This task changed or was deleted. Refresh the list before editing it.');
  return index;
}
function endIndex(flow: ChecklistFlow, index: number) {
  const descendants = new Set([flow.items[index]!.id]);
  let end = index + 1;
  while (end < flow.items.length && descendants.has(flow.items[end]!.parentId ?? '')) {
    descendants.add(flow.items[end]!.id); end++;
  }
  return end;
}
export function checklistSubtreeIds(flow: ChecklistFlow, taskId: string): string[] {
  const checked = readChecklistFlow(flow); const index = taskIndex(checked, taskId);
  return checked.items.slice(index, endIndex(checked, index)).map((task) => task.id);
}
export function checklistRows(flow: ChecklistFlow, hideCompleted = false): { task: ChecklistTask; depth: number }[] {
  const checked = readChecklistFlow(flow); const depths = new Map<string, number>();
  const hidden = new Set<string>();
  return checked.items.flatMap((task) => {
    const depth = task.parentId ? (depths.get(task.parentId)! + 1) : 0; depths.set(task.id, depth);
    if (hideCompleted && (task.checked || Boolean(task.parentId && hidden.has(task.parentId)))) { hidden.add(task.id); return []; }
    return [{ task, depth }];
  });
}

export function prioritizeChecklistRows(rows: readonly { task: ChecklistTask; depth: number }[]) {
  return [...rows.filter(({ task }) => task.checked), ...rows.filter(({ task }) => !task.checked)];
}
function uncheckAncestors(flow: ChecklistFlow, parentId: string | null) {
  while (parentId) { const parent = flow.items[taskIndex(flow, parentId)]!; parent.checked = false; parentId = parent.parentId; }
}
function move(flow: ChecklistFlow, taskId: string, parentId: string | null, beforeId?: string | null): ChecklistFlow {
  const start = taskIndex(flow, taskId); const end = endIndex(flow, start);
  const subtree = flow.items.slice(start, end); const ids = new Set(subtree.map((task) => task.id));
  if (parentId !== null && (!id(parentId) || ids.has(parentId))) throw new Error('A task cannot be nested inside itself or one of its subtasks.');
  if (parentId !== null) taskIndex(flow, parentId);
  if (beforeId && ids.has(beforeId)) throw new Error('Choose a destination outside the moving task.');
  const remaining: ChecklistFlow = { ...flow, items: flow.items.filter((task) => !ids.has(task.id)) };
  let destination: number;
  if (beforeId) {
    destination = taskIndex(remaining, beforeId);
    if (remaining.items[destination]!.parentId !== parentId) throw new Error('Choose a task at the destination nesting level.');
  } else if (parentId) {
    const parent = taskIndex(remaining, parentId); destination = endIndex(remaining, parent);
  } else destination = remaining.items.length;
  subtree[0]!.parentId = parentId;
  remaining.items.splice(destination, 0, ...subtree);
  if (!subtree[0]!.checked) uncheckAncestors(remaining, parentId);
  return readChecklistFlow(remaining);
}

/** All operations clone/validate before returning. Callers persist the single
 * resulting document with its observed revision as an atomic precondition. */
export function applyChecklistChange(value: ChecklistFlow, change: ChecklistChange): ChecklistFlow {
  const flow = readChecklistFlow(value);
  if (change.type === 'add') {
    const item = readChecklistFlow({ kind: 'checklistFlow', version: 1, items: [{ ...change.item, parentId: null }] }).items[0]!;
    item.parentId = change.item.parentId;
    if (flow.items.some((task) => task.id === item.id)) throw new Error('This task already exists.');
    if (flow.items.length >= MAX_CHECKLIST_TASKS) throw new Error(`A checklist can contain up to ${MAX_CHECKLIST_TASKS} tasks.`);
    if (item.parentId !== null) taskIndex(flow, item.parentId);
    let index = item.parentId ? endIndex(flow, taskIndex(flow, item.parentId)) : flow.items.length;
    if (change.afterId) {
      const after = taskIndex(flow, change.afterId);
      if (flow.items[after]!.parentId !== item.parentId) throw new Error('Add the new row beside a task at the same nesting level.');
      index = endIndex(flow, after);
    }
    flow.items.splice(index, 0, item); if (!item.checked) uncheckAncestors(flow, item.parentId);
  } else if (change.type === 'reset') {
    for (const item of flow.items) item.checked = false;
  } else {
    const index = taskIndex(flow, change.id); const item = flow.items[index]!;
    if (change.type === 'edit') {
      if (change.text !== undefined) item.text = change.text;
      if (change.format !== undefined) item.format = change.format;
    } else if (change.type === 'delete') {
      flow.items.splice(index, endIndex(flow, index) - index);
    } else if (change.type === 'deleteRow') {
      const end = endIndex(flow, index);
      for (let child = index + 1; child < end; child++) {
        const descendant = flow.items[child]!;
        if (descendant.parentId === item.id) descendant.parentId = item.parentId;
      }
      flow.items.splice(index, 1);
    } else if (change.type === 'check') {
      if (typeof change.checked !== 'boolean') throw invalid();
      item.checked = change.checked;
      if (change.checked) for (let child = index + 1, end = endIndex(flow, index); child < end; child++) flow.items[child]!.checked = true;
      else uncheckAncestors(flow, item.parentId);
    } else if (change.type === 'move') return move(flow, item.id, change.parentId, change.beforeId);
    else if (change.type === 'moveRelative') {
      const siblings = flow.items.filter((task) => task.parentId === item.parentId); const at = siblings.findIndex((task) => task.id === item.id);
      if (change.direction === 'up') {
        if (!at) return flow; return move(flow, item.id, item.parentId, siblings[at - 1]!.id);
      }
      if (change.direction !== 'down') throw invalid();
      if (at === siblings.length - 1) return flow;
      return move(flow, item.id, item.parentId, siblings[at + 2]?.id ?? null);
    } else if (change.type === 'indent') {
      const siblings = flow.items.filter((task) => task.parentId === item.parentId); const at = siblings.findIndex((task) => task.id === item.id);
      if (!at) return flow; return move(flow, item.id, siblings[at - 1]!.id);
    } else if (change.type === 'outdent') {
      if (!item.parentId) return flow;
      const parent = flow.items[taskIndex(flow, item.parentId)]!;
      const siblings = flow.items.filter((task) => task.parentId === parent.parentId); const at = siblings.findIndex((task) => task.id === parent.id);
      return move(flow, item.id, parent.parentId, siblings[at + 1]?.id ?? null);
    } else throw invalid();
  }
  return readChecklistFlow(flow);
}

function listName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_CHECKLIST_LIST_NAME ||
      /[\u0000-\u001F\u007F]/.test(value)) throw new Error(`Give the checklist a name of 1–${MAX_CHECKLIST_LIST_NAME} characters.`);
  return value.trim();
}

export function emptyChecklistCollection(): ChecklistCollection {
  return { kind: 'checklistFlow', version: 2, lists: [{
    id: DEFAULT_CHECKLIST_LIST_ID, name: DEFAULT_CHECKLIST_LIST_NAME, items: [],
  }] };
}

/** V1 is migrated in memory only. Readers never publish an empty replacement,
 * and the V1 decoder deliberately continues rejecting V2 collection values. */
export function readChecklistCollection(value: unknown): ChecklistCollection {
  if (value === null || value === undefined) return emptyChecklistCollection();
  if (!object(value)) throw invalid();
  if (value.kind === 'checklistFlow' && value.version === 1) {
    const flow = readChecklistFlow(value);
    return readChecklistCollection({ kind: 'checklistFlow', version: 2, lists: [{
      id: DEFAULT_CHECKLIST_LIST_ID, name: DEFAULT_CHECKLIST_LIST_NAME, items: flow.items,
    }] });
  }
  keys(value, ['kind', 'version', 'lists']);
  if (value.kind !== 'checklistFlow' || value.version !== 2 || !Array.isArray(value.lists) ||
      !value.lists.length || value.lists.length > MAX_CHECKLIST_LISTS) throw invalid();
  const seenLists = new Set<string>(); const seenTasks = new Set<string>();
  let taskCount = 0; let totalText = 0;
  const lists: ChecklistList[] = value.lists.map((list) => {
    if (!object(list)) throw invalid();
    keys(list, ['id', 'name', 'items']);
    if (!id(list.id) || seenLists.has(list.id)) throw invalid();
    const flow = readChecklistFlow({ kind: 'checklistFlow', version: 1, items: list.items });
    for (const task of flow.items) {
      if (seenTasks.has(task.id)) throw invalid();
      seenTasks.add(task.id); totalText += task.text.length;
    }
    taskCount += flow.items.length;
    if (taskCount > MAX_CHECKLIST_TASKS) throw new Error(`All checklists together can contain up to ${MAX_CHECKLIST_TASKS} tasks.`);
    if (totalText > MAX_TOTAL_TEXT) throw new Error('The checklists contain too much text. Shorten a task before saving.');
    seenLists.add(list.id);
    return { id: list.id, name: listName(list.name), items: flow.items };
  });
  if (!seenLists.has(DEFAULT_CHECKLIST_LIST_ID)) throw invalid();
  const collection: ChecklistCollection = { kind: 'checklistFlow', version: 2, lists };
  if (serializedUtf8Bytes(collection) > 1024 * 1024)
    throw new Error('The checklists are too large to synchronize. Shorten a task or remove unused rows.');
  return collection;
}

function collectionList(collection: ChecklistCollection, listId: string): ChecklistList {
  const list = collection.lists.find((candidate) => candidate.id === listId);
  if (!list) throw new Error('This checklist changed or is no longer available. Choose a checklist before editing.');
  return list;
}

/** The view stays V1 so existing task, subtree and drag helpers remain scoped to one list. */
export function checklistListFlow(value: ChecklistCollection, listId = DEFAULT_CHECKLIST_LIST_ID): ChecklistFlow {
  const collection = readChecklistCollection(value);
  return { kind: 'checklistFlow', version: 1, items: collectionList(collection, listId).items };
}

export function checklistListSummaries(value: ChecklistCollection): ChecklistListSummary[] {
  return readChecklistCollection(value).lists.map((list) => ({ id: list.id, name: list.name, taskCount: list.items.length }));
}

export function applyChecklistListChange(value: ChecklistCollection, listId: string, change: ChecklistChange): ChecklistCollection {
  const collection = readChecklistCollection(value); const list = collectionList(collection, listId);
  list.items = applyChecklistChange({ kind: 'checklistFlow', version: 1, items: list.items }, change).items;
  return readChecklistCollection(collection);
}

/** Keep the moved task and its children together in one collection edit. */
export function moveChecklistTaskToList(value: ChecklistCollection, sourceListId: string, taskId: string,
  destinationListId: string): ChecklistCollection {
  const collection = readChecklistCollection(value);
  const source = collectionList(collection, sourceListId);
  const destination = collectionList(collection, destinationListId);
  if (source === destination) throw new Error('Choose a different checklist.');
  const flow: ChecklistFlow = { kind: 'checklistFlow', version: 1, items: source.items };
  const start = taskIndex(flow, taskId);
  const moving = source.items.splice(start, endIndex(flow, start) - start);
  moving[0]!.parentId = null;
  destination.items.push(...moving);
  return readChecklistCollection(collection);
}

/** Undo/Redo can replace only the list captured by its history entry. The data
 * adapter must additionally fence the entire collection's observed revision. */
export function replaceChecklistListInCollection(value: ChecklistCollection, listId: string, flow: ChecklistFlow): ChecklistCollection {
  const collection = readChecklistCollection(value); const list = collectionList(collection, listId);
  list.items = readChecklistFlow(flow).items;
  return readChecklistCollection(collection);
}

export function createChecklistListInCollection(value: ChecklistCollection, listId: string, name: string): ChecklistCollection {
  const collection = readChecklistCollection(value);
  if (!id(listId) || collection.lists.some((list) => list.id === listId)) throw new Error('This checklist already exists or has an invalid identity.');
  if (collection.lists.length >= MAX_CHECKLIST_LISTS) throw new Error(`You can keep up to ${MAX_CHECKLIST_LISTS} checklists.`);
  collection.lists.push({ id: listId, name: listName(name), items: [] });
  return readChecklistCollection(collection);
}

export function renameChecklistListInCollection(value: ChecklistCollection, listId: string, name: string): ChecklistCollection {
  const collection = readChecklistCollection(value);
  collectionList(collection, listId).name = listName(name);
  return readChecklistCollection(collection);
}
