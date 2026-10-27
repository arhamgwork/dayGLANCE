import { describe, it, expect } from 'vitest';
import { parseSearchQuery, queryMatchesFields, matchRanges } from './searchQuery.js';

// The Spotlight query language (#2235).
const texts = (terms) => terms.map(t => t.text);
const matches = (query, ...fields) => queryMatchesFields(parseSearchQuery(query), fields);

describe('parseSearchQuery', () => {
  it('splits words, keeps a quoted phrase whole, and reads -word as an exclusion', () => {
    const q = parseSearchQuery('roof "repair quote" -done -"not now"');
    expect(texts(q.include)).toEqual(['roof', 'repair quote']);
    expect(texts(q.exclude)).toEqual(['done', 'not now']);
  });

  it('an unclosed quote runs to the end', () => {
    expect(texts(parseSearchQuery('"call the').include)).toEqual(['call the']);
  });

  it('drops what says nothing: a lone -, empty quotes, wildcards alone', () => {
    const q = parseSearchQuery('- "" * ?? roof');
    expect(texts(q.include)).toEqual(['roof']);
    expect(q.exclude).toEqual([]);
  });
});

describe('queryMatchesFields', () => {
  it('one plain word: a case-insensitive substring, as search always did', () => {
    expect(matches('ROOF', 'Call the roofer')).toBe(true);
    expect(matches('roofs', 'Call the roofer')).toBe(false);
  });

  it('several words: all of them, each in any field', () => {
    expect(matches('roof quote', 'Roofing quote')).toBe(true);
    expect(matches('quote roof', 'Roofing quote')).toBe(true);
    expect(matches('roof supplier', 'Call the roofer', 'ask the supplier first')).toBe(true);
    expect(matches('roof plumber', 'Call the roofer', 'ask the supplier first')).toBe(false);
  });

  it('a quoted phrase matches as written, wildcards in it literal', () => {
    expect(matches('"the roofer"', 'Call the roofer')).toBe(true);
    expect(matches('"roofer the"', 'Call the roofer')).toBe(false);
    expect(matches('"what?"', 'what? now')).toBe(true);
    expect(matches('"what?"', 'whats now')).toBe(false);
  });

  it('* is any run of characters, ? exactly one', () => {
    expect(matches('call*roof', 'Call the roofer')).toBe(true);
    expect(matches('r??fer', 'Call the roofer')).toBe(true);
    expect(matches('r?fer', 'Call the roofer')).toBe(false);
    expect(matches('*quote', 'Roofing quote')).toBe(true);
  });

  it('-word leaves out an item holding it in any field', () => {
    expect(matches('roof -quote', 'Call the roofer')).toBe(true);
    expect(matches('roof -quote', 'Call the roofer', 'get a quote')).toBe(false);
    expect(matches('roof -"get a"', 'Call the roofer', 'get a quote')).toBe(false);
  });

  it('exclusions alone match nothing, rather than everything', () => {
    expect(matches('-done', 'Call the roofer')).toBe(false);
    expect(matches('', 'Call the roofer')).toBe(false);
  });

  it('regex characters are plain text', () => {
    expect(matches('c++', 'Learn C++')).toBe(true);
    expect(matches('a.b', 'aXb')).toBe(false);
    expect(matches('(draft)', 'Report (draft)')).toBe(true);
    expect(matches('[x]', '- [x] done')).toBe(true);
  });

  it('works on text without spaces between words (#2235 was filed in Chinese)', () => {
    expect(matches('任务 链接', '任务链接：无法转到目标任务')).toBe(true);
    expect(matches('任务*目标', '任务链接：无法转到目标任务')).toBe(true);
    expect(matches('任务 -链接', '任务链接：无法转到目标任务')).toBe(false);
  });
});

describe('matchRanges', () => {
  it('every included word, sorted, overlaps merged', () => {
    const q = parseSearchQuery('roof oof quote');
    expect(matchRanges(q, 'Roofing quote, roof')).toEqual([
      { start: 0, end: 4 }, { start: 8, end: 13 }, { start: 15, end: 19 },
    ]);
  });
  it('a wildcard marks the shortest stretch it needs', () => {
    expect(matchRanges(parseSearchQuery('r*f'), 'roof roof')).toEqual([{ start: 0, end: 4 }, { start: 5, end: 9 }]);
  });
});
