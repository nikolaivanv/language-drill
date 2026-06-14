import type { FreeWritingError, FreeWritingSeverity } from '@language-drill/shared';

export type MarkedSegment =
  | { text: string }
  | { good: string }
  | { errorRef: number; original: string; correction: string; severity: FreeWritingSeverity };

type Span =
  | { start: number; end: number; kind: 'error'; error: FreeWritingError }
  | { start: number; end: number; kind: 'good'; good: string };

/**
 * Reconstruct annotated paragraphs from the learner's ORIGINAL text plus the
 * located errors / good spans. The output always concatenates back to the
 * original text — spans that can't be found, or that overlap an already-placed
 * span, are simply dropped. Errors take precedence over good spans on overlap.
 */
export function reconstructMarked(
  original: string,
  errors: FreeWritingError[],
  goodSpans: string[],
): MarkedSegment[][] {
  // 1. Collect candidate spans by first-occurrence index.
  const candidates: Span[] = [];
  for (const error of errors) {
    if (!error.original) continue;
    const idx = original.indexOf(error.original);
    if (idx === -1) continue;
    candidates.push({ start: idx, end: idx + error.original.length, kind: 'error', error });
  }
  for (const good of goodSpans) {
    if (!good) continue;
    const idx = original.indexOf(good);
    if (idx === -1) continue;
    candidates.push({ start: idx, end: idx + good.length, kind: 'good', good });
  }

  // 2. Resolve overlaps: errors before good, then earlier start, then longer.
  candidates.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'error' ? -1 : 1;
    if (a.start !== b.start) return a.start - b.start;
    return b.end - a.end;
  });
  const placed: Span[] = [];
  for (const span of candidates) {
    if (placed.some((p) => span.start < p.end && p.start < span.end)) continue;
    placed.push(span);
  }
  placed.sort((a, b) => a.start - b.start);

  // 3. Walk the text, emitting plain text between spans and the spans themselves.
  const flat: MarkedSegment[] = [];
  let cursor = 0;
  const pushText = (s: string) => {
    if (s) flat.push({ text: s });
  };
  for (const span of placed) {
    pushText(original.slice(cursor, span.start));
    if (span.kind === 'error') {
      flat.push({
        errorRef: span.error.n,
        original: span.error.original,
        correction: span.error.correction,
        severity: span.error.severity,
      });
    } else {
      flat.push({ good: span.good });
    }
    cursor = span.end;
  }
  pushText(original.slice(cursor));

  // 4. Split into paragraphs on blank lines, re-splicing segments at boundaries.
  return splitParagraphs(flat);
}

function splitParagraphs(flat: MarkedSegment[]): MarkedSegment[][] {
  const paras: MarkedSegment[][] = [];
  let current: MarkedSegment[] = [];
  for (const seg of flat) {
    if (!('text' in seg)) {
      current.push(seg);
      continue;
    }
    const parts = seg.text.split(/\n\s*\n/);
    parts.forEach((part, i) => {
      if (i > 0) {
        paras.push(current);
        current = [];
      }
      if (part) current.push({ text: part });
    });
  }
  paras.push(current);
  // Drop fully-empty trailing paragraphs but keep at least one.
  const nonEmpty = paras.filter((p) => p.length > 0);
  return nonEmpty.length ? nonEmpty : [[]];
}
