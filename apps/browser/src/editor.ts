export type BrowserTextDraft = { input: { value: string }; original: string; revision: string | undefined };

/** The input remains live while a local write is pending. Do not close it until its latest tail is acknowledged. */
export async function flushBrowserText(draft: BrowserTextDraft, isCurrent: () => boolean,
  save: (text: string, expectedRevision: string | undefined) => Promise<string | undefined>): Promise<boolean> {
  while (draft.input.value !== draft.original) {
    if (!isCurrent()) return false;
    const text = draft.input.value; const revision = await save(text, draft.revision);
    if (!isCurrent()) return false;
    draft.original = text; draft.revision = revision;
  }
  return isCurrent();
}
