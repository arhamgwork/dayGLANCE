import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { markdownTableAt, renderFormattedText } from './textFormatting.jsx';

// #2247: Markdown tables in notes, and ~~strikethrough~~.
const html = (text) => renderToStaticMarkup(<div>{renderFormattedText(text)}</div>);

describe('markdownTableAt', () => {
  it('reads a header, a delimiter row with alignment, and the body rows', () => {
    const lines = ['| Item | Qty | Price |', '|:-----|:---:|------:|', '| Tiles | 40 | 120 |', '| Nails | 1 | 8 |', 'after'];
    expect(markdownTableAt(lines, 0)).toEqual({
      header: ['Item', 'Qty', 'Price'],
      align: ['left', 'center', 'right'],
      rows: [['Tiles', '40', '120'], ['Nails', '1', '8']],
      next: 4,
    });
  });

  it('takes rows without outer pipes, pads short rows, cuts long ones, and reads \\| as a pipe', () => {
    const t = markdownTableAt(['a | b', '--- | ---', 'one |', 'x | y | z', 'p \\| q | r'], 0);
    expect(t.align).toEqual([null, null]);
    expect(t.rows).toEqual([['one', ''], ['x', 'y'], ['p | q', 'r']]);
  });

  it('ends at the first line with no pipe, so a sentence typed after it is not a row', () => {
    expect(markdownTableAt(['a | b', '---|---', '1 | 2', 'Thanks for the quote'], 0).next).toBe(3);
  });

  it('is not a table without a matching delimiter row', () => {
    expect(markdownTableAt(['a | b', 'not a delimiter'], 0)).toBeNull();
    expect(markdownTableAt(['a | b', '---'], 0)).toBeNull();               // one cell under two
    expect(markdownTableAt(['- a | b', '- c'], 0)).toBeNull();             // a list
    expect(markdownTableAt(['plain', '---'], 0)).toBeNull();               // a rule under text
    expect(markdownTableAt(['| a |'], 0)).toBeNull();                      // nothing after
  });
});

describe('renderFormattedText: tables', () => {
  const note = 'Quote:\n| Item | Price |\n|---|--:|\n| **Tiles** | ~~150~~ 120 |\n| Nails | 8 |\nThanks';

  it('draws the table in a box that scrolls sideways, cells keeping their formatting', () => {
    const out = html(note);
    expect(out).toContain('data-note-table');
    expect(out).toContain('overflow-x-auto');
    expect(out).toMatch(/<th[^>]*text-align:left[^>]*>Item<\/th>/);
    expect(out).toMatch(/<th[^>]*text-align:right[^>]*>Price<\/th>/);
    expect(out).toContain('<td class="border px-2 py-1 align-top" style="border-color:rgba(128,128,128,0.35);text-align:left"><strong>Tiles</strong></td>');
    expect(out).toContain('<s>150</s> 120');
    expect(out).not.toContain('|---|');
  });

  it('the lines around it render as before', () => {
    const out = html(note);
    expect(out.indexOf('Quote:')).toBeLessThan(out.indexOf('<table'));
    expect(out.indexOf('Thanks')).toBeGreaterThan(out.indexOf('</table>'));
  });

  it('a pipe in ordinary text stays text', () => {
    expect(html('either a | b\nnext line')).not.toContain('<table');
  });
});

describe('renderFormattedText: strikethrough', () => {
  it('~~text~~ is struck through, inline with other formatting', () => {
    expect(html('buy ~~milk~~ **bread**')).toBe('<div><div>buy <s>milk</s> <strong>bread</strong></div></div>');
  });

  it('a single ~ (the time sigil) is left alone, and links still work', () => {
    expect(html('call ~3pm')).toBe('<div><div>call ~3pm</div></div>');
    expect(html('see https://example.com/a')).toContain('<a href="https://example.com/a"');
    expect(html('see https://example.com/a')).toContain('>https://example.com/a</a>');
  });
});
