// ---------------------------------------------------------------------------
// tokenize — split a passage into word / separator spans
// ---------------------------------------------------------------------------
// `AnnotatedText` (Phase J read screen) renders the passage by walking these
// spans: each `word` token may render as a clickable `<button>` if its `key`
// matches a flagged-word entry, while `sep` tokens render as plain text. The
// prototype's tokenizer (`design_handoff_language_drill/.../read.jsx:175–198`)
// only handled the ES punctuation set — this version covers anything in the
// Unicode `\p{P}` (Punctuation) class plus whitespace, so the same code works
// for ES `¿¡`, DE `„ « »`, TR `…` and em-dashes without per-language branches.
//
// The server-side pre-filter shares this tokenizer (more-responsive-reading
// spec Req 1.3): single-character tokens and digit-only tokens are emitted as
// `sep` so they never enter the candidate set sent to Claude.
// ---------------------------------------------------------------------------

export type TokenSpan = {
  kind: 'word' | 'sep';
  raw: string;
  /** Lowercased, punctuation-stripped form for matching against `flaggedMap` keys. Empty for separators. */
  key: string;
};

// Single split regex: one or more whitespace or Unicode punctuation chars.
// The capturing group keeps the separator runs in the split output so we can
// reconstruct the passage byte-for-byte. The `u` flag enables `\p{P}`.
const SEPARATOR_SPLIT_RE = /([\s\p{P}]+)/u;

const PUNCT_STRIP_RE = /\p{P}/gu;
const DIGIT_ONLY_RE = /^\d+$/u;

export function tokenize(text: string): TokenSpan[] {
  if (text.length === 0) return [];
  const parts = text.split(SEPARATOR_SPLIT_RE);
  const tokens: TokenSpan[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '') continue;
    // With a capturing-group split, odd indices are the captured separators
    // and even indices are the gaps between them.
    if (i % 2 === 1) {
      tokens.push({ kind: 'sep', raw: part, key: '' });
    } else if (part.length === 1 || DIGIT_ONLY_RE.test(part)) {
      // Single-character and numeric-only tokens are not learning targets —
      // emit as `sep` so the renderer keeps them inline as plain text and the
      // pre-filter never treats them as candidates.
      tokens.push({ kind: 'sep', raw: part, key: '' });
    } else {
      tokens.push({
        kind: 'word',
        raw: part,
        key: part.toLowerCase().replace(PUNCT_STRIP_RE, ''),
      });
    }
  }
  return tokens;
}
