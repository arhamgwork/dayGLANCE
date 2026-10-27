import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { highlightMatch } from './textFormatting.jsx';

// Spotlight's result rows mark every word of the query that matched (#2235).
const html = (text, query) => renderToStaticMarkup(<div>{highlightMatch(text, query)}</div>);
const bold = (s) => `<span class="font-bold text-blue-500">${s}</span>`;

describe('highlightMatch', () => {
  it('one word, as before', () => {
    expect(html('Call the roofer', 'roof')).toBe(`<div><span>Call the ${bold('roof')}er</span></div>`);
  });

  it('every word of several, and what a wildcard spans', () => {
    expect(html('Roofing quote', 'quote roof')).toBe(`<div><span>${bold('Roof')}ing ${bold('quote')}</span></div>`);
    expect(html('Roofing quote', 'r*g')).toBe(`<div><span>${bold('Roofing')} quote</span></div>`);
  });

  it('not an excluded word, and the text as is when nothing matches', () => {
    expect(html('Roofing quote', 'roof -quote')).toBe(`<div><span>${bold('Roof')}ing quote</span></div>`);
    expect(html('Roofing quote', 'fence')).toBe('<div>Roofing quote</div>');
  });

  it('long text is cut to the stretch around the first hit, marks clipped to it', () => {
    const text = `${'a'.repeat(50)} roof ${'b'.repeat(50)} quote`;
    const out = html(text, 'roof quote');
    expect(out).toContain(bold('roof'));
    expect(out).not.toContain(bold('quote'));
    expect(out.startsWith('<div><span>…')).toBe(true);
    expect(out.endsWith('…</span></div>')).toBe(true);
  });
});
