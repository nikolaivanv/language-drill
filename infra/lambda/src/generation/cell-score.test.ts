/**
 * Expected-yield ranking (2026-08-30). Deficit ranking adversely selects: the
 * neediest cells are also the least likely to approve anything (measured on
 * prod, the 0.115-approval bucket averaged need 17.6 while the 0.7 bucket
 * averaged 3.1). Ranking on `need × p̂` stops the hopeless tail monopolising
 * the top of the backlog.
 */

import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_PRIOR_WEIGHT,
  computeApprovalPriors,
  expectedYield,
  promptEvidenceCutoff,
  selectStarvedCells,
  shrunkApprovalRate,
} from './cell-score';

describe('shrunkApprovalRate', () => {
  it('returns the prior when there is no evidence', () => {
    // A reset cell (prompt bumped, or point edited) has its evidence scoped
    // away. Collapsing to the prior IS the reset — no separate code path.
    expect(shrunkApprovalRate({ approved: 0, produced: 0, prior: 0.6 })).toBeCloseTo(0.6);
  });

  it('barely moves off the prior on a tiny sample', () => {
    // 23 prod cells sit at a perfect lifetime rate over ~15 drafts each. Left
    // raw they would rocket to the top of the ranking on noise.
    const p = shrunkApprovalRate({ approved: 2, produced: 2, prior: 0.5 });
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(0.6);
  });

  it('converges toward the observed rate as evidence accumulates', () => {
    const light = shrunkApprovalRate({ approved: 20, produced: 20, prior: 0.5 });
    const heavy = shrunkApprovalRate({ approved: 200, produced: 200, prior: 0.5 });
    expect(heavy).toBeGreaterThan(light);
    expect(heavy).toBeGreaterThan(0.9);
  });

  it('weights evidence and prior equally at exactly the prior weight', () => {
    // Sanity-anchors the constant: EVIDENCE_PRIOR_WEIGHT drafts of evidence
    // should count the same as the prior.
    const p = shrunkApprovalRate({
      approved: EVIDENCE_PRIOR_WEIGHT,
      produced: EVIDENCE_PRIOR_WEIGHT,
      prior: 0,
    });
    expect(p).toBeCloseTo(0.5);
  });

  it('stays within [0,1] for a zero-approval cell', () => {
    const p = shrunkApprovalRate({ approved: 0, produced: 500, prior: 0.6 });
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(0.05);
  });
});

describe('expectedYield', () => {
  it('is need scaled by the shrunk rate', () => {
    expect(expectedYield(10, 0.5)).toBeCloseTo(5);
  });

  it('ranks a smaller, productive cell above a needier hopeless one', () => {
    // The whole point: prod bucket 1 (need 17.6, rate 0.115) must not outrank
    // bucket 5 (need 3.0, rate 0.871) the way raw deficit ranking does.
    expect(expectedYield(3, 0.871)).toBeGreaterThan(expectedYield(17, 0.115));
  });
});

describe('computeApprovalPriors', () => {
  const rows = [
    { cellKey: 'de:a1:cloze:x', approved: 8, produced: 10 },
    { cellKey: 'de:a1:cloze:y', approved: 2, produced: 10 },
    { cellKey: 'tr:a1:vocab_recall:z', approved: 1, produced: 10 },
  ];

  it('groups by language and exercise type', () => {
    const priors = computeApprovalPriors(rows);
    expect(priors.forCell('de:a1:cloze:other')).toBeCloseTo(0.5);
    expect(priors.forCell('tr:a1:vocab_recall:other')).toBeCloseTo(0.1);
  });

  it('falls back to the global rate for an unseen group', () => {
    const priors = computeApprovalPriors(rows);
    // 11 approved of 30 produced overall.
    expect(priors.forCell('es:b2:translation:unseen')).toBeCloseTo(11 / 30);
  });

  it('falls back to a neutral rate when there is no evidence at all', () => {
    // First run after a prompt bump discards every row; the ranking must still
    // produce a number rather than NaN.
    const priors = computeApprovalPriors([]);
    expect(priors.forCell('de:a1:cloze:x')).toBeCloseTo(0.5);
  });
});

describe('promptEvidenceCutoff', () => {
  it('takes the latest date across the supplied prompt versions', () => {
    // A generation OR a validation change invalidates the evidence, so the
    // cutoff is the later of the two.
    expect(
      promptEvidenceCutoff(['generate@2026-08-18', 'validate@2026-09-02']),
    ).toEqual(new Date('2026-09-02T00:00:00.000Z'));
  });

  it('ignores a version with no parseable date rather than wiping evidence', () => {
    // Mirrors decideEnqueue's missing-metadata rule: never let a metadata
    // problem take a destructive action. Here that means keeping evidence.
    expect(promptEvidenceCutoff(['generate@2026-08-18', 'nonsense'])).toEqual(
      new Date('2026-08-18T00:00:00.000Z'),
    );
  });

  it('returns the epoch when nothing parses, keeping all evidence', () => {
    expect(promptEvidenceCutoff(['nonsense']).getTime()).toBe(0);
    expect(promptEvidenceCutoff([]).getTime()).toBe(0);
  });
});

describe('selectStarvedCells', () => {
  const cell = (cellKey: string, need: number, pHat: number, scopedDrafts = 0) => ({
    cell: { language: cellKey.slice(0, 2).toUpperCase(), cellKey },
    need,
    pHat,
    score: need * pHat,
    scopedDrafts,
  });

  it('excludes near-complete cells the finishing reserve already handles', () => {
    // The 2026-08-31 defect: sorted by absolute score, all ten entries were
    // need=1 vocab cells sitting at 29 rows against 28 targets. They had not
    // been starved — they lost the 8-slot finishing-reserve lottery. A need=1
    // cell can never score above 1.0 however healthy, so low-need cells
    // structurally filled the list.
    const starved = selectStarvedCells(
      [cell('tr:a1:vocab_recall:done', 1, 0.13), cell('de:b2:cloze:stuck', 20, 0.2)],
      { needFloor: 5, limit: 10 },
    );
    expect(starved.map((c) => c.cellKey)).toEqual(['de:b2:cloze:stuck']);
  });

  it('ranks by approval rate, not by score', () => {
    // score would put the big-need cell last; the rate is what says "this one
    // needs a fix rather than more drafts".
    const starved = selectStarvedCells(
      [cell('de:b2:cloze:big', 40, 0.5), cell('de:b2:cloze:hopeless', 10, 0.05)],
      { needFloor: 5, limit: 10 },
    );
    expect(starved.map((c) => c.cellKey)).toEqual([
      'de:b2:cloze:hopeless',
      'de:b2:cloze:big',
    ]);
  });

  it('breaks equal rates on need, biggest first', () => {
    // Cells with no scoped evidence all share their group prior, so ties are
    // the common case, not an edge case. Among equally unpromising cells the
    // one holding the most unmet need is the more useful report.
    const starved = selectStarvedCells(
      [cell('de:b2:cloze:small', 6, 0.13), cell('de:b2:cloze:large', 30, 0.13)],
      { needFloor: 5, limit: 10 },
    );
    expect(starved.map((c) => c.cellKey)).toEqual([
      'de:b2:cloze:large',
      'de:b2:cloze:small',
    ]);
  });

  it('reports scoped draft volume so a prior can be told from a measurement', () => {
    // pHat 0.13 on 0 drafts is "never measured"; on 200 drafts it is a verdict.
    // Without this the reader cannot tell which they are looking at.
    const starved = selectStarvedCells([cell('de:b2:cloze:x', 20, 0.13, 200)], {
      needFloor: 5,
      limit: 10,
    });
    expect(starved[0]).toMatchObject({ scopedDrafts: 200, pHat: 0.13, need: 20 });
  });

  it('honours the limit', () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      cell(`de:b2:cloze:c${String(i).padStart(2, '0')}`, 10, i / 100),
    );
    expect(selectStarvedCells(many, { needFloor: 5, limit: 10 })).toHaveLength(10);
  });

  it('returns nothing when every deferred cell is a finisher', () => {
    expect(
      selectStarvedCells([cell('de:b2:cloze:a', 3, 0.1)], { needFloor: 5, limit: 10 }),
    ).toEqual([]);
  });
});
