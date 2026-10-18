/**
 * Word-class mix for themed vocab umbrellas (2026-10-17 vocab expansion). Pure
 * helpers: the authoring run measures its batch against the quota, asks once
 * for a shortfall, and trims surplus nouns/phrases so the umbrella lands inside
 * it. Word-class groups (`vocabGroup`) do not use the mix.
 */
import { VOCAB_POS, type VocabPos } from '@language-drill/shared';

export type PosCounts = Record<VocabPos, number>;

export function emptyPosCounts(): PosCounts {
  return Object.fromEntries(VOCAB_POS.map((p) => [p, 0])) as PosCounts;
}

export function countPos(rows: readonly { pos: VocabPos | null }[]): PosCounts {
  const c = emptyPosCounts();
  for (const r of rows) if (r.pos) c[r.pos] += 1;
  return c;
}

export type MixQuota = {
  maxNounShare: number;
  minVerbShare: number;
  minAdjAdvShare: number;
  maxPhraseShare: number;
};

export const THEMED_MIX: MixQuota = {
  maxNounShare: 0.6,
  minVerbShare: 0.2,
  minAdjAdvShare: 0.15,
  maxPhraseShare: 0.1,
};

export type Shortfall = { verb: number; adjectiveOrAdverb: number };

const total = (c: PosCounts): number => VOCAB_POS.reduce((n, p) => n + c[p], 0);

// Floating-point guards: 0.2 * 30 is 6.000000000000001 and 0.6 / 0.4 is
// 1.4999999999999998, so a bare ceil/floor would be off by one on exact shares.
const EPS = 1e-9;
const ceilShare = (share: number, size: number): number => Math.ceil(share * size - EPS);
const floorShare = (x: number): number => Math.floor(x + EPS);

export function mixShortfall(counts: PosCounts, size: number, quota: MixQuota = THEMED_MIX): Shortfall {
  return {
    verb: Math.max(0, ceilShare(quota.minVerbShare, size) - counts.verb),
    adjectiveOrAdverb: Math.max(
      0,
      ceilShare(quota.minAdjAdvShare, size) - (counts.adjective + counts.adverb),
    ),
  };
}

/**
 * Keep the batch's priority order; drop phrases beyond maxPhraseShare of the
 * resulting total and nouns beyond maxNounShare (existing rows count).
 * nouns ≤ s·(nouns + others) ⇔ nouns ≤ s/(1−s)·others.
 */
export function fitToMix<T extends { pos: VocabPos }>(
  existing: PosCounts,
  batch: readonly T[],
  quota: MixQuota = THEMED_MIX,
): T[] {
  const nounRatio = quota.maxNounShare / (1 - quota.maxNounShare);
  const keepFirst = (rows: readonly T[], pos: VocabPos, cap: number): T[] => {
    let seen = 0;
    return rows.filter((w) => {
      if (w.pos !== pos) return true;
      seen += 1;
      return seen <= cap;
    });
  };

  // Trimming nouns shrinks the total, which tightens the phrase cap (and vice
  // versa), so iterate until neither pass removes anything. Strictly shrinking,
  // so it terminates.
  let kept: T[] = [...batch];
  for (;;) {
    const before = kept.length;
    const phraseCap = Math.max(
      0,
      floorShare(quota.maxPhraseShare * (total(existing) + kept.length)) - existing.phrase,
    );
    kept = keepFirst(kept, 'phrase', phraseCap);

    const others = total(existing) - existing.noun + kept.filter((w) => w.pos !== 'noun').length;
    const nounCap = Math.max(0, floorShare(nounRatio * others) - existing.noun);
    kept = keepFirst(kept, 'noun', nounCap);

    if (kept.length === before) return kept;
  }
}

/** `--fill-mix`: non-noun request for `growth` new words that also closes the shortfall. */
export function planFillMixRequest(
  existing: PosCounts,
  growth: number,
  quota: MixQuota = THEMED_MIX,
): Shortfall {
  const base = total(existing);
  const short = mixShortfall(existing, base + growth, quota);
  const verb = Math.max(short.verb, Math.round(growth * 0.6));
  let req: Shortfall = { verb, adjectiveOrAdverb: Math.max(short.adjectiveOrAdverb, growth - verb) };
  // The request itself grows the final total, which raises the quota; re-measure
  // against the size the request produces until stable (capped).
  for (let i = 0; i < 5; i++) {
    const next = mixShortfall(existing, base + req.verb + req.adjectiveOrAdverb, quota);
    const grown: Shortfall = {
      verb: Math.max(req.verb, next.verb),
      adjectiveOrAdverb: Math.max(req.adjectiveOrAdverb, next.adjectiveOrAdverb),
    };
    if (grown.verb === req.verb && grown.adjectiveOrAdverb === req.adjectiveOrAdverb) break;
    req = grown;
  }
  return req;
}
