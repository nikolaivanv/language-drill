// ---------------------------------------------------------------------------
// read-span-utils — server-authoritative span-type resolution
// ---------------------------------------------------------------------------
// `POST /read/annotate-span` receives a selection as character offsets and
// must decide which `DeepCard` shape (word | phrase | sentence) to request
// from Claude. The server derives this from the offsets alone and never trusts
// a client-supplied type, because the span type drives the cache key, the
// save-rejection rule, and the card layout (design Component 4; Req 4.3, 5.1).
//
// Rules (word-count takes precedence so a one-word sentence like "Vino." is a
// word card, per the design's "single token → word"):
//   - 0–1 word tokens in the span          → "word"
//   - ≥2 word tokens, span == a sentence   → "sentence"
//   - ≥2 word tokens, otherwise            → "phrase"
//
// A span "is a sentence" when its content (whitespace- and terminal-
// punctuation-trimmed) equals a sentence detected by splitting the passage on
// `. ! ?`. Trimming terminal punctuation means selecting "Vino." or "Vino"
// resolves the same way. Sentence detection is a heuristic — abbreviations and
// decimals are not special-cased (design notes this as acceptable).
// ---------------------------------------------------------------------------

import { tokenize } from "@language-drill/shared";
import type { SpanType } from "@language-drill/ai";

const TERMINATORS = new Set([".", "!", "?"]);
const WS_RE = /\s/u;

function isSpace(ch: string): boolean {
  return WS_RE.test(ch);
}

/**
 * Trim leading/trailing whitespace AND trailing terminal punctuation from
 * `[start, end)`, returning the inner content offsets.
 */
function contentRange(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let s = start;
  let e = end;
  while (s < e && isSpace(text[s])) s++;
  while (e > s && (isSpace(text[e - 1]) || TERMINATORS.has(text[e - 1]))) e--;
  return { start: s, end: e };
}

/**
 * Sentence ranges over the whole passage: each spans from its first content
 * char to just past its terminating run of `. ! ?`. A trailing fragment with
 * no terminator becomes the final range.
 */
export function detectSentenceRanges(
  text: string,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    while (i < n && isSpace(text[i])) i++;
    if (i >= n) break;
    const start = i;
    while (i < n && !TERMINATORS.has(text[i])) i++;
    while (i < n && TERMINATORS.has(text[i])) i++;
    ranges.push({ start, end: i });
  }
  return ranges;
}

/** Number of `word`-kind tokens in a substring (single-char/digit tokens are `sep`). */
function wordCount(span: string): number {
  let count = 0;
  for (const token of tokenize(span)) {
    if (token.kind === "word") count++;
  }
  return count;
}

/**
 * Decide the `DeepCard` shape for a selected span from its character offsets.
 * See the module header for the rules.
 */
export function resolveSpanType(
  text: string,
  start: number,
  end: number,
): SpanType {
  const span = text.slice(start, end);
  if (wordCount(span) <= 1) return "word";

  const sel = contentRange(text, start, end);
  for (const range of detectSentenceRanges(text)) {
    const content = contentRange(text, range.start, range.end);
    if (content.start === sel.start && content.end === sel.end) {
      return "sentence";
    }
  }
  return "phrase";
}
