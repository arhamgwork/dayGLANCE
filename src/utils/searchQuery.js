// The Spotlight query language (#2235). Pure: spotlightSearch.js matches with
// it and highlightMatch (textFormatting.jsx) marks what it matched.
//
//   roof quote       every word must match, each anywhere in the item (one in
//                    the title and one in the notes is a match)
//   "roof repair"    a phrase, matched as written; * and ? inside are literal
//   roof*quote       * is any run of characters, ? is exactly one
//   -done            leaves out anything that matches it
//
// Matching ignores case. One plain word matches exactly as search always
// did: anywhere inside a field, as a substring. A word made only of
// wildcards, or a lone "-", says nothing and is dropped; a query left with
// nothing to include matches nothing, rather than listing everything.

// The characters a RegExp would read as syntax, less the two wildcards
// (handled below). With the u flag only these (and /) may be escaped.
const SYNTAX = /[\\^$.+()[\]{}|/]/g;

function compile(text, { literal }) {
  let source = '';
  for (const ch of text) {
    if (!literal && ch === '*') source += '[\\s\\S]*?';
    else if (!literal && ch === '?') source += '[\\s\\S]';
    else if (ch === '*' || ch === '?') source += `\\${ch}`;
    else source += ch.replace(SYNTAX, '\\$&');
  }
  return new RegExp(source, 'iu');
}

/**
 * @typedef {{ text: string, regex: RegExp }} SearchTerm
 * @typedef {{ include: SearchTerm[], exclude: SearchTerm[] }} SearchQuery
 */

/**
 * Parse what was typed into the terms to include and exclude.
 * @param {string} raw
 * @returns {SearchQuery}
 */
export function parseSearchQuery(raw) {
  const include = [];
  const exclude = [];
  // A quoted phrase (closed or not), or a run without whitespace; either may
  // carry a leading "-".
  const token = /(-?)"([^"]*)"?|(\S+)/g;
  for (const m of (raw || '').matchAll(token)) {
    let negate = m[1] === '-';
    let text = m[2] ?? m[3];
    const literal = m[2] !== undefined;
    if (!literal && text.startsWith('-')) { negate = true; text = text.slice(1); }
    text = text.trim();
    // Nothing literal to look for: a lone "-", empty quotes, or only wildcards.
    if (!text || (!literal && !/[^*?]/.test(text))) continue;
    (negate ? exclude : include).push({ text, regex: compile(text, { literal }) });
  }
  return { include, exclude };
}

/** Accepts what callers hold: the raw text or an already parsed query. */
export const asSearchQuery = (query) => (typeof query === 'string' ? parseSearchQuery(query) : query);

/** Whether `text` contains `term`. */
export const termMatches = (term, text) => !!text && term.regex.test(text);

/**
 * Whether an item made of these fields matches: every included term in at
 * least one field, and no excluded term in any.
 * @param {SearchQuery} query
 * @param {string[]} fields
 */
export function queryMatchesFields(query, fields) {
  if (!query.include.length) return false;
  const present = fields.filter(Boolean);
  if (query.exclude.some(term => present.some(text => termMatches(term, text)))) return false;
  return query.include.every(term => present.some(text => termMatches(term, text)));
}

/**
 * Where the included terms occur in `text`, as sorted, non-overlapping
 * `{ start, end }` ranges, for highlighting.
 * @param {SearchQuery} query
 * @param {string} text
 */
export function matchRanges(query, text) {
  if (!text) return [];
  const ranges = [];
  for (const term of query.include) {
    const global = new RegExp(term.regex.source, 'giu');
    for (const m of text.matchAll(global)) {
      if (m[0].length) ranges.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}
