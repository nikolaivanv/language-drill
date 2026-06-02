import { describe, it, expect } from 'vitest';

import {
  GenerationReasonCode,
  REASON_LABELS,
  REJECTED_BRANCH_CODES,
  formatReason,
  normalizeFlaggedReasons,
  type GenerationReason,
} from './generation-reasons';

// ---------------------------------------------------------------------------
// generation-reasons — the canonical reason vocabulary + display/back-compat
// helpers. Covers the bounded-cardinality contract (every code has a label;
// REJECTED_BRANCH_CODES are valid members) and the throw-free read path that
// tolerates legacy `string[]` rows alongside the new `{ code, detail }[]` shape.
// ---------------------------------------------------------------------------

describe('REASON_LABELS', () => {
  it('has a non-empty label for every enum member', () => {
    for (const code of Object.values(GenerationReasonCode)) {
      expect(typeof REASON_LABELS[code]).toBe('string');
      expect(REASON_LABELS[code].length).toBeGreaterThan(0);
    }
  });
});

describe('REJECTED_BRANCH_CODES', () => {
  it('are all valid enum members', () => {
    const members = new Set<string>(Object.values(GenerationReasonCode));
    for (const code of REJECTED_BRANCH_CODES) {
      expect(members.has(code)).toBe(true);
    }
  });

  it('does not include flag-only codes', () => {
    expect(REJECTED_BRANCH_CODES).not.toContain(GenerationReasonCode.Ambiguous);
    expect(REJECTED_BRANCH_CODES).not.toContain(
      GenerationReasonCode.ValidatorNote,
    );
    expect(REJECTED_BRANCH_CODES).not.toContain(
      GenerationReasonCode.LegacyUncoded,
    );
  });
});

describe('formatReason', () => {
  it('renders label + detail when a detail is present', () => {
    expect(
      formatReason({
        code: GenerationReasonCode.CulturalIssue,
        detail: "'Ulan' is a coarse interjection",
      }),
    ).toBe("Cultural issue: 'Ulan' is a coarse interjection");
  });

  it('renders the label alone when no detail', () => {
    expect(formatReason({ code: GenerationReasonCode.Ambiguous })).toBe(
      'Ambiguous',
    );
  });

  it('falls back to the raw code for an unknown/future code', () => {
    const unknown = {
      code: 'some-future-code' as GenerationReasonCode,
      detail: 'x',
    };
    expect(formatReason(unknown)).toBe('some-future-code: x');
  });
});

describe('normalizeFlaggedReasons', () => {
  it('passes through the new { code, detail } shape', () => {
    const input: GenerationReason[] = [
      { code: GenerationReasonCode.Ambiguous },
      { code: GenerationReasonCode.CulturalIssue, detail: 'prose here' },
    ];
    expect(normalizeFlaggedReasons(input)).toEqual(input);
  });

  it('wraps legacy string[] elements under legacy-uncoded, preserving prose', () => {
    const legacy = ['low quality score (<0.7)', 'a 200-char model paragraph …'];
    expect(normalizeFlaggedReasons(legacy)).toEqual([
      {
        code: GenerationReasonCode.LegacyUncoded,
        detail: 'low quality score (<0.7)',
      },
      {
        code: GenerationReasonCode.LegacyUncoded,
        detail: 'a 200-char model paragraph …',
      },
    ]);
  });

  it('returns [] for null, undefined, and non-array input', () => {
    expect(normalizeFlaggedReasons(null)).toEqual([]);
    expect(normalizeFlaggedReasons(undefined)).toEqual([]);
    expect(normalizeFlaggedReasons('not an array')).toEqual([]);
    expect(normalizeFlaggedReasons(42)).toEqual([]);
    expect(normalizeFlaggedReasons({ code: 'x' })).toEqual([]);
  });

  it('drops malformed elements but keeps valid siblings (never throws)', () => {
    const mixed = [
      { code: GenerationReasonCode.LevelMismatch },
      null,
      42,
      { detail: 'no code' },
      { code: GenerationReasonCode.ValidatorNote, detail: 'kept' },
    ];
    expect(normalizeFlaggedReasons(mixed)).toEqual([
      { code: GenerationReasonCode.LevelMismatch },
      { code: GenerationReasonCode.ValidatorNote, detail: 'kept' },
    ]);
  });

  it('drops a non-string detail rather than carrying it through', () => {
    const input = [{ code: GenerationReasonCode.Ambiguous, detail: 123 }];
    expect(normalizeFlaggedReasons(input)).toEqual([
      { code: GenerationReasonCode.Ambiguous },
    ]);
  });
});
