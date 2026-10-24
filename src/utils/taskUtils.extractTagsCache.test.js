import { describe, expect, it } from 'vitest';
import { extractTags } from './taskUtils.js';

// #2143, step 3: extractTags remembers each title's tags, so the lists, filters
// and counts that re-read every title on each change stop re-running the regex.

describe('extractTags cache', () => {
  it('answers as before: lower-cased, web addresses skipped, any script', () => {
    expect(extractTags('Plan #Work and #deep/focus')).toEqual(['work', 'deep/focus']);
    expect(extractTags('Read https://example.com/a#frag #reading')).toEqual(['reading']);
    expect(extractTags('报告 #工作')).toEqual(['工作']);
    expect(extractTags(null)).toEqual([]);
  });

  it('gives back the same frozen array for the same title, a new one for a changed title', () => {
    const a = extractTags('Call roofer #home');
    expect(extractTags('Call roofer #home')).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(() => { 'use strict'; a.push('x'); }).toThrow();
    expect(extractTags('Call roofer #house')).toEqual(['house']);
  });

  it('keeps answering correctly past its size bound', () => {
    for (let i = 0; i < 20050; i++) extractTags(`Task ${i} #t${i % 7}`);
    expect(extractTags('Task 3 #t3')).toEqual(['t3']);
    expect(extractTags('Fresh #new')).toEqual(['new']);
  });
});
