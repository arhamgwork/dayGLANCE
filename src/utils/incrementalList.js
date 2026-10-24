// How many of a list's items to render (hooks/useIncrementalList.js, #2143).
// Pure.

/**
 * `limit`, raised to take in every id in `keep` that sits past it, plus
 * `step` rows after the furthest of them so the row is not the last one on
 * screen. Never more than the list holds.
 */
export function incrementalLimit(items, limit, keep = [], { step = 0, getId = (item) => item.id } = {}) {
  const length = Array.isArray(items) ? items.length : 0;
  let count = Math.min(Math.max(0, limit), length);
  const wanted = new Set(keep.filter(id => id != null).map(String));
  if (wanted.size === 0 || count >= length) return count;
  for (let i = count; i < length; i++) {
    if (wanted.has(String(getId(items[i])))) count = Math.min(length, i + 1 + step);
  }
  return count;
}
