import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import { coachMessage, type CoachContext } from '../coach-messages';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

type Tier = 'praise' | 'light' | 'encourage' | 'reset';

const TYPES: ExerciseType[] = [
  ExerciseType.CLOZE,
  ExerciseType.TRANSLATION,
  ExerciseType.VOCAB_RECALL,
];

// One representative score strictly inside each tier band so the choice of
// score below doesn't conflate band boundaries with the tier itself. Boundary
// behavior is locked in its own describe block further down.
const TIER_SCORES: Record<Tier, number> = {
  praise: 0.97,
  light: 0.8,
  encourage: 0.5,
  reset: 0.2,
};

const TIERS: Tier[] = ['praise', 'light', 'encourage', 'reset'];

// Covers the two emoji blocks plus dingbats / Misc-Symbols-and-Pictographs.
const emojiRegex =
  /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{1F000}-\u{1F2FF}]/u;

const gamificationRegex = /streak|xp|lesson|days?|sessions?|points?/i;

// Build the full set of (kind, type, score?) contexts that the helper covers.
const allRows: Array<{ name: string; ctx: CoachContext }> = [
  ...TYPES.map((type) => ({
    name: `idle ${type}`,
    ctx: { kind: 'idle' as const, type },
  })),
  ...TYPES.flatMap((type) =>
    TIERS.map((tier) => ({
      name: `evaluated ${type} / ${tier}`,
      ctx: {
        kind: 'evaluated' as const,
        type,
        score: TIER_SCORES[tier],
      } satisfies CoachContext,
    })),
  ),
];

// ---------------------------------------------------------------------------
// 1. All 15 strings exist and are non-empty
// ---------------------------------------------------------------------------

describe('coachMessage — coverage', () => {
  it('produces 15 distinct contexts (3 idle + 12 evaluated)', () => {
    expect(allRows).toHaveLength(15);
  });

  it.each(allRows)('$name returns a non-empty string', ({ ctx }) => {
    const out = coachMessage(ctx);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. No emoji, 3. no exclamation marks, 4. no gamification vocabulary
// ---------------------------------------------------------------------------

describe('coachMessage — copy hygiene', () => {
  it.each(allRows)('$name contains no emoji', ({ ctx }) => {
    expect(coachMessage(ctx)).not.toMatch(emojiRegex);
  });

  it.each(allRows)('$name contains no exclamation mark', ({ ctx }) => {
    expect(coachMessage(ctx)).not.toContain('!');
  });

  it.each(allRows)(
    '$name contains no streak/XP/lesson/day/session/points vocabulary',
    ({ ctx }) => {
      expect(coachMessage(ctx)).not.toMatch(gamificationRegex);
    },
  );
});

// ---------------------------------------------------------------------------
// 5. No duplicates within a single exercise type's 4 evaluated strings
// ---------------------------------------------------------------------------

describe('coachMessage — uniqueness within a type', () => {
  it.each(TYPES)(
    '%s has 4 distinct evaluated strings (one per tier)',
    (type) => {
      const messages = TIERS.map((tier) =>
        coachMessage({ kind: 'evaluated', type, score: TIER_SCORES[tier] }),
      );
      expect(new Set(messages).size).toBe(4);
    },
  );
});

// ---------------------------------------------------------------------------
// 6. One assertion per (type, tier) pair locking the API surface (not copy)
// ---------------------------------------------------------------------------

describe('coachMessage — (type, tier) API surface', () => {
  type TierRow = { type: ExerciseType; score: number; tier: Tier };

  const tierRows: TierRow[] = TYPES.flatMap((type) =>
    TIERS.map((tier) => ({ type, score: TIER_SCORES[tier], tier })),
  );

  it.each(tierRows)(
    'evaluated $type at score $score routes to $tier (non-empty string)',
    ({ type, score }) => {
      const out = coachMessage({ kind: 'evaluated', type, score });
      expect(out.length).toBeGreaterThan(0);
    },
  );
});

// ---------------------------------------------------------------------------
// 7. Score-band boundary correctness
// ---------------------------------------------------------------------------

describe('coachMessage — score-band boundaries', () => {
  // Boundary scores route to the higher tier:
  //   0.95 → praise (not light)
  //   0.7  → light  (not encourage)
  //   0.4  → encourage (not reset)
  // We assert this by sampling a clearly-in-band score for the higher tier and
  // requiring the boundary score to produce the same string.
  type BoundaryRow = {
    name: string;
    boundary: number;
    higherTierSample: number;
    lowerTierSample: number;
  };

  const boundaryRows: BoundaryRow[] = [
    {
      name: '0.95 routes to praise (not light)',
      boundary: 0.95,
      higherTierSample: TIER_SCORES.praise, // 0.97
      lowerTierSample: TIER_SCORES.light, // 0.8
    },
    {
      name: '0.7 routes to light (not encourage)',
      boundary: 0.7,
      higherTierSample: TIER_SCORES.light, // 0.8
      lowerTierSample: TIER_SCORES.encourage, // 0.5
    },
    {
      name: '0.4 routes to encourage (not reset)',
      boundary: 0.4,
      higherTierSample: TIER_SCORES.encourage, // 0.5
      lowerTierSample: TIER_SCORES.reset, // 0.2
    },
  ];

  describe.each(boundaryRows)(
    '$name',
    ({ boundary, higherTierSample, lowerTierSample }) => {
      it.each(TYPES)('%s', (type) => {
        const atBoundary = coachMessage({
          kind: 'evaluated',
          type,
          score: boundary,
        });
        const inHigherBand = coachMessage({
          kind: 'evaluated',
          type,
          score: higherTierSample,
        });
        const inLowerBand = coachMessage({
          kind: 'evaluated',
          type,
          score: lowerTierSample,
        });
        expect(atBoundary).toBe(inHigherBand);
        expect(atBoundary).not.toBe(inLowerBand);
      });
    },
  );

  // For every type, two scores within the same band yield the same string.
  describe('two scores within the same band yield the same string', () => {
    type WithinBandRow = { tier: Tier; a: number; b: number };

    const withinBandRows: WithinBandRow[] = [
      { tier: 'praise', a: 0.95, b: 1.0 },
      { tier: 'light', a: 0.7, b: 0.94 },
      { tier: 'encourage', a: 0.5, b: 0.6 },
      { tier: 'reset', a: 0.0, b: 0.39 },
    ];

    it.each(
      TYPES.flatMap((type) =>
        withinBandRows.map((row) => ({ type, ...row })),
      ),
    )('$type / $tier: scores $a and $b yield same string', ({ type, a, b }) => {
      expect(coachMessage({ kind: 'evaluated', type, score: a })).toBe(
        coachMessage({ kind: 'evaluated', type, score: b }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Pinned idle copies (Req 2 AC #2) — the exception to "don't lock the copy"
// ---------------------------------------------------------------------------

describe('coachMessage — pinned idle copy (Req 2 AC #2)', () => {
  it('cloze idle copy is pinned', () => {
    expect(
      coachMessage({ kind: 'idle', type: ExerciseType.CLOZE }),
    ).toBe('fill the blank · type it out');
  });

  it('translation idle copy is pinned', () => {
    expect(
      coachMessage({ kind: 'idle', type: ExerciseType.TRANSLATION }),
    ).toBe('translate the meaning, not every word');
  });

  it('vocab idle copy is pinned', () => {
    expect(
      coachMessage({ kind: 'idle', type: ExerciseType.VOCAB_RECALL }),
    ).toBe('say it from memory');
  });
});

// ---------------------------------------------------------------------------
// sessionComplete branch (Req 4.4)
// ---------------------------------------------------------------------------

describe('coachMessage — sessionComplete', () => {
  it('null accuracy yields the no-data line', () => {
    expect(coachMessage({ kind: 'sessionComplete', accuracy: null })).toBe(
      "Nice work — let's see what landed.",
    );
  });

  it('accuracy ≥ 0.9 yields the strong-session line', () => {
    expect(coachMessage({ kind: 'sessionComplete', accuracy: 0.95 })).toBe(
      'Strong session — that one stuck.',
    );
    expect(coachMessage({ kind: 'sessionComplete', accuracy: 1 })).toBe(
      'Strong session — that one stuck.',
    );
  });

  it('0.9 boundary routes to strong-session (not solid)', () => {
    expect(coachMessage({ kind: 'sessionComplete', accuracy: 0.9 })).toBe(
      'Strong session — that one stuck.',
    );
  });

  it('accuracy in [0.7, 0.9) yields the solid-session line', () => {
    expect(coachMessage({ kind: 'sessionComplete', accuracy: 0.85 })).toBe(
      'Solid session.',
    );
  });

  it('0.7 boundary routes to solid-session (not tough)', () => {
    expect(coachMessage({ kind: 'sessionComplete', accuracy: 0.7 })).toBe(
      'Solid session.',
    );
  });

  it('accuracy < 0.7 yields the tough-session line', () => {
    expect(coachMessage({ kind: 'sessionComplete', accuracy: 0.5 })).toBe(
      'That one was tough — good signal.',
    );
    expect(coachMessage({ kind: 'sessionComplete', accuracy: 0 })).toBe(
      'That one was tough — good signal.',
    );
  });
});

// ---------------------------------------------------------------------------
// SENTENCE_CONSTRUCTION coverage
// ---------------------------------------------------------------------------

describe('coachMessage — SENTENCE_CONSTRUCTION', () => {
  it('returns an idle message for sentence_construction', () => {
    const msg = coachMessage({ kind: 'idle', type: ExerciseType.SENTENCE_CONSTRUCTION });
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('returns an evaluated message for sentence_construction at each tier', () => {
    for (const score of [0.97, 0.8, 0.5, 0.2]) {
      const msg = coachMessage({ kind: 'evaluated', type: ExerciseType.SENTENCE_CONSTRUCTION, score });
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});
