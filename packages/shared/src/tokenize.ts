// ---------------------------------------------------------------------------
// tokenize — split a passage into word / separator spans
// ---------------------------------------------------------------------------
// `AnnotatedText` (Phase J read screen) renders the passage by walking these
// spans: each `word` token may render as a clickable `<button>` if its `key`
// matches a flagged-word entry, while `sep` tokens render as plain text. The
// prototype's tokenizer (`docs/design-archive/design_handoff_language_drill/.../read.jsx:175–198`)
// only handled the ES punctuation set — this version covers anything in the
// Unicode `\p{P}` (Punctuation) class plus whitespace, so the same code works
// for ES `¿¡`, DE `„ « »`, TR `…` and em-dashes without per-language branches.
//
// **Word-internal connectors** (hyphen-minus `-` and the apostrophe variants
// `'` / `'`) are kept inside a word when they sit BETWEEN two word characters
// — so "e-posta", "well-known", "don't", "l'eau", and "Anne'nin" all tokenize
// as single words. Standalone hyphens/apostrophes (at a word edge or in the
// middle of a separator run) stay separators, and em-dashes / en-dashes are
// always separators.
//
// The server-side pre-filter shares this tokenizer (more-responsive-reading
// spec Req 1.3): single-character tokens and digit-only tokens are emitted as
// `sep` so they never enter the candidate set sent to Claude.
// ---------------------------------------------------------------------------

export type TokenSpan = {
  kind: 'word' | 'sep';
  raw: string;
  /**
   * Lowercased surface form for matching against `flaggedMap` keys. Word-
   * internal connectors (hyphen-minus, apostrophes) are preserved so the key
   * matches Claude's `matchedForm` (which is the lowercased EXACT surface).
   * Empty for separators.
   */
  key: string;
};

// Characters that may sit inside a word when surrounded by word chars on both
// sides. Em-dash (—) and en-dash (–) are NOT in this set — they always split.
const WORD_INTERNAL_CONNECTORS = new Set(['-', "'", '’']);
const SEP_RE = /[\s\p{P}]/u;
const DIGIT_ONLY_RE = /^\d+$/u;

/**
 * True when `text[i]` is a connector character (`-`/`'`/`'`) sandwiched
 * between two non-separator characters — i.e. part of a word.
 */
function isInternalConnectorAt(text: string, i: number): boolean {
  if (!WORD_INTERNAL_CONNECTORS.has(text[i])) return false;
  if (i === 0 || i === text.length - 1) return false;
  return !SEP_RE.test(text[i - 1]) && !SEP_RE.test(text[i + 1]);
}

export function tokenize(text: string): TokenSpan[] {
  if (text.length === 0) return [];
  const tokens: TokenSpan[] = [];
  let i = 0;
  while (i < text.length) {
    const startsWithSep =
      SEP_RE.test(text[i]) && !isInternalConnectorAt(text, i);
    if (startsWithSep) {
      // Separator run — accumulate until the next word character (or an
      // internal connector that opens a word).
      let j = i + 1;
      while (
        j < text.length &&
        SEP_RE.test(text[j]) &&
        !isInternalConnectorAt(text, j)
      ) {
        j++;
      }
      tokens.push({ kind: 'sep', raw: text.slice(i, j), key: '' });
      i = j;
    } else {
      // Word run — accumulate non-sep characters, plus internal connectors.
      let j = i + 1;
      while (j < text.length) {
        const c = text[j];
        if (!SEP_RE.test(c)) {
          j++;
          continue;
        }
        if (isInternalConnectorAt(text, j)) {
          j++;
          continue;
        }
        break;
      }
      const part = text.slice(i, j);
      if (part.length === 1 || DIGIT_ONLY_RE.test(part)) {
        // Single-character and numeric-only tokens are not learning targets —
        // emit as `sep` so the renderer keeps them inline as plain text and
        // the pre-filter never treats them as candidates.
        tokens.push({ kind: 'sep', raw: part, key: '' });
      } else {
        tokens.push({
          kind: 'word',
          raw: part,
          key: part.toLowerCase(),
        });
      }
      i = j;
    }
  }
  return tokens;
}
