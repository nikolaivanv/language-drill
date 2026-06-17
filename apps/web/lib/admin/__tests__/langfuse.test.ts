import { describe, it, expect } from 'vitest';
import { cellKeyFor, buildLangfuseTracesUrl } from '../langfuse';

describe('cellKeyFor', () => {
  it('builds the canonical lowercased cell key (grammarPoint not lowercased)', () => {
    expect(cellKeyFor({ language: 'TR', level: 'A1', type: 'cloze', grammarPoint: 'tr-a1-vowel-harmony' }))
      .toBe('tr:a1:cloze:tr-a1-vowel-harmony');
  });
  it('returns null when any part is missing or empty', () => {
    expect(cellKeyFor({ language: null, level: 'A1', type: 'cloze', grammarPoint: 'g' })).toBeNull();
    expect(cellKeyFor({ language: 'TR', level: '', type: 'cloze', grammarPoint: 'g' })).toBeNull();
    expect(cellKeyFor({ language: 'TR', level: 'A1', type: null, grammarPoint: 'g' })).toBeNull();
    expect(cellKeyFor({ language: 'TR', level: 'A1', type: 'cloze', grammarPoint: null })).toBeNull();
  });
});

describe('buildLangfuseTracesUrl', () => {
  const tmpl = 'https://cloud.langfuse.com/project/p1/traces?q={cellKey}';
  it('interpolates and URL-encodes the cell key', () => {
    expect(buildLangfuseTracesUrl('tr:a1:cloze:g', tmpl))
      .toBe('https://cloud.langfuse.com/project/p1/traces?q=tr%3Aa1%3Acloze%3Ag');
  });
  it('replaces every occurrence of the placeholder', () => {
    expect(buildLangfuseTracesUrl('a:b', 'x={cellKey}&y={cellKey}')).toBe('x=a%3Ab&y=a%3Ab');
  });
  it('returns null when the template is undefined or lacks the placeholder', () => {
    expect(buildLangfuseTracesUrl('a:b', undefined)).toBeNull();
    expect(buildLangfuseTracesUrl('a:b', 'https://x/traces')).toBeNull();
  });
});
