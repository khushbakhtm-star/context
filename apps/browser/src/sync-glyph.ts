/** Static glyph state follows the existing worker and real error state only.
 * The button keeps its own action, accessible name and detailed status text. */
export function applySyncGlyphState(button: HTMLElement, active: boolean, issue: boolean) {
  button.dataset.syncState = issue ? 'issue' : active ? 'active' : 'idle';
  button.setAttribute('aria-busy', String(active));
}
