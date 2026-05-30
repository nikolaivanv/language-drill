import { describe, it, expect } from 'vitest';
import { tokenize, type TokenSpan } from './tokenize';

// ---------------------------------------------------------------------------
// tokenize — covers the punctuation/whitespace cases the design listed
// (ES, DE, TR, em-dash, mixed punctuation, Unicode letters, edges).
//
// Round-trip invariant: joining `raw` over every token reproduces the input
// exactly. This continues to hold under the new single-char / digit-only
// behavior because the `raw` field is preserved regardless of `kind`.
//
// New behavior (more-responsive-reading Req 1.3):
//   - single-character tokens emit `kind: 'sep'`
//   - digit-only tokens emit `kind: 'sep'`
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

  it('treats single-char tokens as sep around em-dash: "a—b"', () => {
    // Pre-spec the surrounding "a" and "b" tokens would have been kind:'word';
    // under the shared tokenizer they are emitted as kind:'sep' so the server
    // pre-filter never sends single-character candidates to Claude.
    const tokens = tokenize('a—b');
    expect(tokens).toEqual([
      { kind: 'sep', raw: 'a', key: '' },
      { kind: 'sep', raw: '—', key: '' },
      { kind: 'sep', raw: 'b', key: '' },
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
    expect(joinRaw(tokens)).toBe('«hallo»');
  });

  it('splits TR ellipsis: "hmm…"', () => {
    const tokens = tokenize('hmm…');
    expect(tokens).toEqual([
      { kind: 'word', raw: 'hmm', key: 'hmm' },
      { kind: 'sep', raw: '…', key: '' },
    ]);
    expect(joinRaw(tokens)).toBe('hmm…');
  });

  it('coalesces consecutive punctuation ";:" into a single separator with single-char neighbors as sep: "a;:b"', () => {
    const tokens = tokenize('a;:b');
    expect(tokens).toEqual([
      { kind: 'sep', raw: 'a', key: '' },
      { kind: 'sep', raw: ';:', key: '' },
      { kind: 'sep', raw: 'b', key: '' },
    ]);
    expect(joinRaw(tokens)).toBe('a;:b');
  });

  it('coalesces consecutive whitespace into a single separator with single-char neighbors as sep: "a  b"', () => {
    const tokens = tokenize('a  b');
    expect(tokens).toEqual([
      { kind: 'sep', raw: 'a', key: '' },
      { kind: 'sep', raw: '  ', key: '' },
      { kind: 'sep', raw: 'b', key: '' },
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

  // -------------------------------------------------------------------------
  // New behavior — Req 1.3
  // -------------------------------------------------------------------------

  it('emits digit-only tokens as sep: "2024"', () => {
    const tokens = tokenize('2024');
    expect(tokens).toEqual([{ kind: 'sep', raw: '2024', key: '' }]);
    expect(joinRaw(tokens)).toBe('2024');
  });

  it('emits a single-character token as sep: "a"', () => {
    const tokens = tokenize('a');
    expect(tokens).toEqual([{ kind: 'sep', raw: 'a', key: '' }]);
    expect(joinRaw(tokens)).toBe('a');
  });

  it('emits digit-only tokens as sep inside a sentence: "Born in 1999 sí"', () => {
    // "1999" is digit-only → sep. "in" is multi-char → word. "Born" word. "sí"
    // is two characters → word. Round-trip preserves the digits.
    const text = 'Born in 1999 sí';
    const tokens = tokenize(text);
    expect(tokens).toEqual([
      { kind: 'word', raw: 'Born', key: 'born' },
      { kind: 'sep', raw: ' ', key: '' },
      { kind: 'word', raw: 'in', key: 'in' },
      { kind: 'sep', raw: ' ', key: '' },
      { kind: 'sep', raw: '1999', key: '' },
      { kind: 'sep', raw: ' ', key: '' },
      { kind: 'word', raw: 'sí', key: 'sí' },
    ]);
    expect(joinRaw(tokens)).toBe(text);
  });

  it('keeps mixed letter+digit tokens as word (digit-only check is strict): "café2x"', () => {
    // The digit-only rule fires only when EVERY character is a digit, so an
    // alphanumeric like "café2x" stays a word — its key still strips
    // punctuation and lowercases, keeping the digit.
    const tokens = tokenize('café2x');
    expect(tokens).toEqual([{ kind: 'word', raw: 'café2x', key: 'café2x' }]);
    expect(joinRaw(tokens)).toBe('café2x');
  });

  // -------------------------------------------------------------------------
  // Word-internal connectors — hyphen-minus and apostrophes between word chars
  // -------------------------------------------------------------------------

  it('keeps a hyphen-minus between word chars as part of the word: "e-posta"', () => {
    const tokens = tokenize('e-posta');
    expect(tokens).toEqual([
      { kind: 'word', raw: 'e-posta', key: 'e-posta' },
    ]);
    expect(joinRaw(tokens)).toBe('e-posta');
  });

  it('keeps a hyphen between multi-character words: "well-known"', () => {
    const tokens = tokenize('well-known');
    expect(tokens).toEqual([
      { kind: 'word', raw: 'well-known', key: 'well-known' },
    ]);
    expect(joinRaw(tokens)).toBe('well-known');
  });

  it('keeps an ASCII apostrophe between word chars: "don\'t"', () => {
    const tokens = tokenize("don't");
    expect(tokens).toEqual([{ kind: 'word', raw: "don't", key: "don't" }]);
    expect(joinRaw(tokens)).toBe("don't");
  });

  it('keeps a curly apostrophe between word chars: "Anne’nin"', () => {
    const tokens = tokenize('Anne’nin');
    expect(tokens).toEqual([
      { kind: 'word', raw: 'Anne’nin', key: 'anne’nin' },
    ]);
    expect(joinRaw(tokens)).toBe('Anne’nin');
  });

  it('treats a leading hyphen as a separator: "-abc"', () => {
    const tokens = tokenize('-abc');
    expect(tokens).toEqual([
      { kind: 'sep', raw: '-', key: '' },
      { kind: 'word', raw: 'abc', key: 'abc' },
    ]);
    expect(joinRaw(tokens)).toBe('-abc');
  });

  it('treats a trailing hyphen as a separator: "abc-"', () => {
    const tokens = tokenize('abc-');
    expect(tokens).toEqual([
      { kind: 'word', raw: 'abc', key: 'abc' },
      { kind: 'sep', raw: '-', key: '' },
    ]);
    expect(joinRaw(tokens)).toBe('abc-');
  });

  it('keeps em-dashes as separators even between word chars: "foo—bar"', () => {
    // Regression guard: the internal-connector rule is restricted to
    // hyphen-minus + apostrophes, NOT em-dash / en-dash, which always split.
    const tokens = tokenize('foo—bar');
    expect(tokens).toEqual([
      { kind: 'word', raw: 'foo', key: 'foo' },
      { kind: 'sep', raw: '—', key: '' },
      { kind: 'word', raw: 'bar', key: 'bar' },
    ]);
  });

  it('word keys match the skim pass\' lowercased matchedForm', () => {
    // Documents the contract with annotate.ts: `matchedForm` is the lowercased
    // EXACT surface form. The tokenizer's key must match it so the flaggedMap
    // lookup hits for hyphenated and apostrophe'd words.
    const tokens = tokenize('E-posta gönderdim.');
    const wordKeys = tokens.filter((t) => t.kind === 'word').map((t) => t.key);
    expect(wordKeys).toEqual(['e-posta', 'gönderdim']);
  });

  it('preserves round-trip across mixed scripts and digits: "Привет 2024 dünya!"', () => {
    // Cyrillic "Привет" (6 chars, word), digit-only "2024" (sep under new
    // behavior), Latin-extended "dünya" (5 chars, word). Round-trip must hold.
    const text = 'Привет 2024 dünya!';
    const tokens = tokenize(text);
    expect(joinRaw(tokens)).toBe(text);
    expect(tokens.filter((t) => t.kind === 'word').map((t) => t.key)).toEqual([
      'привет',
      'dünya',
    ]);
    // The digit run lives between two spaces; the new behavior turns the
    // digit token itself into a sep — so the sequence space-digits-space
    // appears as three separate sep tokens.
    expect(tokens.filter((t) => t.kind === 'sep').map((t) => t.raw)).toEqual([
      ' ',
      '2024',
      ' ',
      '!',
    ]);
  });
});
