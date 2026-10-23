import { useCallback, useEffect, useRef, useState } from 'react';
import { incrementalLimit } from '../utils/incrementalList.js';

/** The window event that asks every incremental list to render a task's row. */
export const REVEAL_TASK_EVENT = 'dayglance:reveal-task';

/** Ask the lists to render `id`'s row (search scrolls to it next). */
export function revealTask(id) {
  if (typeof window === 'undefined' || id == null) return;
  window.dispatchEvent(new CustomEvent(REVEAL_TASK_EVENT, { detail: { id } }));
}

// The nearest ancestor that scrolls: the sentinel's IntersectionObserver
// root, so its margin reaches ahead inside that container rather than the
// window, which the container clips.
function scrollParent(el) {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

/**
 * Render a long list a part at a time (#2143, step 2). Building every Inbox
 * row on open cost about a millisecond a row, so a few thousand tasks froze
 * the app for seconds each time the Inbox opened. The list now renders its
 * first `initial` items and `step` more whenever the end comes within
 * `aheadPx` of the scroll container's edge, before it is on screen.
 *
 * Rows the user is working on are always rendered: any id in `keep` (the
 * row being renamed, with its notes or deadline picker open), and a row
 * asked for by revealTask (search, before it scrolls to it).
 *
 * @returns {{ visible: Array, hasMore: boolean, sentinelRef: (el) => void }}
 *   Render `visible`, and an element with `sentinelRef` after it while
 *   `hasMore`.
 */
export default function useIncrementalList(items, { initial = 60, step = 120, aheadPx = 800, keep = [], getId = (item) => item.id } = {}) {
  const [limit, setLimit] = useState(initial);
  const [revealId, setRevealId] = useState(null);

  useEffect(() => {
    const onReveal = (e) => setRevealId(e.detail?.id ?? null);
    window.addEventListener(REVEAL_TASK_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_TASK_EVENT, onReveal);
  }, []);

  const count = incrementalLimit(items, limit, [...keep, revealId], { step, getId });
  // A reveal or a kept row past the limit raises it, so the list does not
  // shrink back when that row is closed.
  useEffect(() => { if (count > limit) setLimit(count); }, [count, limit]);

  const observerRef = useRef(null);
  const sentinelRef = useCallback((el) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) setLimit(n => n + step);
    }, { root: scrollParent(el), rootMargin: `0px 0px ${aheadPx}px 0px` });
    observer.observe(el);
    observerRef.current = observer;
  }, [step, aheadPx]);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  const visible = count >= items.length ? items : items.slice(0, count);
  return { visible, hasMore: count < items.length, sentinelRef };
}
