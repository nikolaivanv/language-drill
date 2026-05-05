import { describe, it, expect } from 'vitest';
import { tokenize, type TokenSpan } from './tokenize';

// ---------------------------------------------------------------------------
// tokenize — covers the punctuation/whitespace cases the design listed
// (ES, DE, TR, em-dash, mixed punctuation, Unicode letters, edges).
// Round-trip invariant: joining `raw` over every token reproduces the input
// exactly. We assert that on every non-edge case below.
// ---------------------------------------------------------------------------

function joinRaw(tokens: TokenSpan[]): string {
  return tokens.map((t) => t.raw).join('');
}

describe('tokenize', () => {
  it('splits ASCII period: "hello."', () => {
    const tokens = tokenize('hello.');
    expect(tokens).toEqual([
      { kind: 'word', raw: 'hello', key: 'hello' },
      { kind: 'sep', raw: '.', key: '' },
    ]);
    expect(joinRaw(tokens)).toBe('hello.');
  });

  it('splits em-dash: "a—b"', () => {
    const tokens = tokenize('a—b');
    expect(tokens).toEqual([
      { kind: 'word', raw: 'a', key: 'a' },
      { kind: 'sep', raw: '—', key: '' },
      { kind: 'word', raw: 'b', key: 'b' },
    ]);
    expect(joinRaw(tokens)).toBe('a—b');
  });

  it('splits ES inverted question marks: "¿qué?"', () => {
    const tokens = tokenize('¿qué?');
    expect(tokens).toEqual([
      { kind: 'sep', raw: '¿', key: '' },
      { kind: 'word', raw: 'qué', key: 'qué' },
      { kind: 'sep', raw: '?', key: '' },
    ]);
    expect(joinRaw(tokens)).toBe('¿qué?');
  });

  it('splits ES inverted exclamation: "¡vale!"', () => {
    const tokens = tokenize('¡vale!');
    expect(tokens).toEqual([
      { kind: 'sep', raw: '¡', key: '' },
      { kind: 'word', raw: 'vale', key: 'vale' },
      { kind: 'sep', raw: '!', key: '' },
    ]);
    expect(joinRaw(tokens)).toBe('¡vale!');
  });

  it('splits DE low-9 quotation: „ja"', () => {
    const tokens = tokenize('„ja"');
    expect(tokens).toEqual([
      { kind: 'sep', raw: '„', key: '' },
      { kind: 'word', raw: 'ja', key: 'ja' },
      { kind: 'sep', raw: '"', key: '' },
    ]);
    expect(joinRaw(tokens)).toBe('„ja"');
  });

  it('splits DE guillemets: «hallo»', () => {
    const tokens = tokenize('«hallo»');
    expect(tokens).toEqual([
      { kind: 'sep', raw: '«', key: '' },
      { kind: 'word', raw: 'hallo', key: 'hallo' },
      { kind: 'sep', raw: '»', key: '' },
    ]);
  });

  it('splits TR ellipsis: "hmm…"', () => {
    const tokens = tokenize('hmm…');
    expect(tokens).toEqual([
      { kind: 'word', raw: 'hmm', key: 'hmm' },
      { kind: 'sep', raw: '…', key: '' },
    ]);
    expect(joinRaw(tokens)).toBe('hmm…');
  });

  it('coalesces consecutive punctuation ";:" into a single separator: "a;:b"', () => {
    const tokens = tokenize('a;:b');
    expect(tokens).toEqual([
      { kind: 'word', raw: 'a', key: 'a' },
      { kind: 'sep', raw: ';:', key: '' },
      { kind: 'word', raw: 'b', key: 'b' },
    ]);
    expect(joinRaw(tokens)).toBe('a;:b');
  });

  it('coalesces consecutive whitespace into a single separator: "a  b"', () => {
    const tokens = tokenize('a  b');
    expect(tokens).toEqual([
      { kind: 'word', raw: 'a', key: 'a' },
      { kind: 'sep', raw: '  ', key: '' },
      { kind: 'word', raw: 'b', key: 'b' },
    ]);
    expect(joinRaw(tokens)).toBe('a  b');
  });

  it('preserves Unicode letters in word.key (ñ, ä, ı): "niño über yarın"', () => {
    const tokens = tokenize('niño über yarın');
    expect(tokens).toEqual([
      { kind: 'word', raw: 'niño', key: 'niño' },
      { kind: 'sep', raw: ' ', key: '' },
      { kind: 'word', raw: 'über', key: 'über' },
      { kind: 'sep', raw: ' ', key: '' },
      { kind: 'word', raw: 'yarın', key: 'yarın' },
    ]);
    expect(joinRaw(tokens)).toBe('niño über yarın');
  });

  it('lowercases the key but keeps `raw` cased: "Hola"', () => {
    const tokens = tokenize('Hola');
    expect(tokens).toEqual([{ kind: 'word', raw: 'Hola', key: 'hola' }]);
  });

  it('returns [] for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('returns a single sep token for a whitespace-only string: "   "', () => {
    const tokens = tokenize('   ');
    expect(tokens).toEqual([{ kind: 'sep', raw: '   ', key: '' }]);
    expect(joinRaw(tokens)).toBe('   ');
  });

  it('returns a single sep token for a punctuation-only string: "—…!?"', () => {
    const tokens = tokenize('—…!?');
    expect(tokens).toEqual([{ kind: 'sep', raw: '—…!?', key: '' }]);
    expect(joinRaw(tokens)).toBe('—…!?');
  });

  it('handles a long sentence with mixed punctuation (round-trips and matches expected key list)', () => {
    const text = '¿Has visto «el niño»? — sí, ayer; pero… no entiendo.';
    const tokens = tokenize(text);
    expect(joinRaw(tokens)).toBe(text);
    const wordKeys = tokens.filter((t) => t.kind === 'word').map((t) => t.key);
    expect(wordKeys).toEqual([
      'has',
      'visto',
      'el',
      'niño',
      'sí',
      'ayer',
      'pero',
      'no',
      'entiendo',
    ]);
  });
});
