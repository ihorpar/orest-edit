/**
 * When the manuscript and the queue are scrolled to the focused suggestion.
 *
 * Only when the focused item changed, or when the editor asked for it again by an explicit action (a click
 * on its card or mark, `До правки`, the arrows of quiet mode): each such action raises `sequence`. Anything
 * else that re-renders the page (switching the panel tab, a poll, typing) must leave the scroll alone.
 */
export interface FocusScrollState {
  focusId: string | null;
  /** Count of explicit focus actions so far. */
  sequence: number;
}

export function shouldScrollToFocus(previous: FocusScrollState | null, next: FocusScrollState): boolean {
  if (!next.focusId) {
    return false;
  }

  return !previous || previous.focusId !== next.focusId || previous.sequence !== next.sequence;
}
