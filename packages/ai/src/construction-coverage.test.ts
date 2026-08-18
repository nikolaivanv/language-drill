import { describe, it, expect } from 'vitest';
import {
  pLimit,
  sampleRowsForCell,
  analyzeCell,
  FINDING_MAX_SHARE,
  JUDGE_HEALTH_MAX_UNRESOLVED_SHARE,
  type ClaimedConstruction,
} from './construction-coverage.js';

const rows = Array.from({ length: 50 }, (_, i) => ({ id: `row-${i}` }));

const constructions: ClaimedConstruction[] = [
  { id: 'backshift', label: 'dijo que + imperfect', mustRepresent: true, rationale: 'r' },
  { id: 'command', label: 'que + present subjunctive', mustRepresent: true, rationale: 'r' },
  { id: 'flavour', label: 'lexical variation', mustRepresent: false, rationale: 'r' },
];

describe('pLimit', () => {
  it('never runs more than `concurrency` jobs at once', async () => {
    const limit = pLimit(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 1));
          active--;
        }),
      ),
    );
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('rejects a concurrency below 1', () => {
    expect(() => pLimit(0)).toThrow(/concurrency/);
  });
});

describe('sampleRowsForCell', () => {
  it('is deterministic for a given seed', () => {
    const a = sampleRowsForCell(rows, 'seed-1', 24).map((r) => r.id);
    const b = sampleRowsForCell(rows, 'seed-1', 24).map((r) => r.id);
    expect(a).toEqual(b);
  });

  it('changes with the seed', () => {
    const a = sampleRowsForCell(rows, 'seed-1', 24).map((r) => r.id);
    const b = sampleRowsForCell(rows, 'seed-2', 24).map((r) => r.id);
    expect(a).not.toEqual(b);
  });

  it('caps at the requested size', () => {
    expect(sampleRowsForCell(rows, 'seed-1', 24)).toHaveLength(24);
  });

  it('returns every row when the cell is at or under the cap', () => {
    const small = rows.slice(0, 10);
    expect(sampleRowsForCell(small, 'seed-1', 24)).toHaveLength(10);
  });

  // Guards the spec's reason for hashing rather than slicing: rows arrive in
  // creation order, and consecutive rows share a generation batch, so a
  // head-of-list sample would measure one batch's habits.
  it('does not simply take the head of the input order', () => {
    const picked = sampleRowsForCell(rows, 'seed-1', 24).map((r) => r.id);
    const head = rows.slice(0, 24).map((r) => r.id);
    expect(picked).not.toEqual(head);
  });
});

describe('analyzeCell', () => {
  const classify = (counts: Record<string, number>) =>
    Object.entries(counts).flatMap(([id, n]) =>
      Array.from({ length: n }, () => ({ constructionId: id })),
    );

  it('reports a finding for a mustRepresent construction at zero', () => {
    const result = analyzeCell({
      constructions,
      classifications: classify({ backshift: 24 }),
      dismissedConstructionIds: new Set<string>(),
    });
    expect(result.status).toBe('finding');
    expect(result.missing.map((m) => m.id)).toEqual(['command']);
  });

  it('reports a finding at or below the 5% share', () => {
    // 1/24 = 4.2% — a finding. The spec makes this cliff explicit.
    const result = analyzeCell({
      constructions,
      classifications: classify({ backshift: 23, command: 1 }),
      dismissedConstructionIds: new Set<string>(),
    });
    expect(result.status).toBe('finding');
    expect(result.missing.map((m) => m.id)).toEqual(['command']);
  });

  it('does not report above the 5% share', () => {
    // 2/24 = 8.3% — not a finding.
    const result = analyzeCell({
      constructions,
      classifications: classify({ backshift: 22, command: 2 }),
      dismissedConstructionIds: new Set<string>(),
    });
    expect(result.status).toBe('ok');
    expect(result.missing).toEqual([]);
  });

  it('ignores constructions that are not mustRepresent', () => {
    const result = analyzeCell({
      constructions,
      classifications: classify({ backshift: 12, command: 12 }),
      dismissedConstructionIds: new Set<string>(),
    });
    expect(result.status).toBe('ok');
  });

  it('suppresses a dismissed construction', () => {
    const result = analyzeCell({
      constructions,
      classifications: classify({ backshift: 24 }),
      dismissedConstructionIds: new Set(['command']),
    });
    expect(result.status).toBe('ok');
    expect(result.missing).toEqual([]);
  });

  it('reports enumeration-suspect when too many rows are unresolved', () => {
    const result = analyzeCell({
      constructions,
      classifications: [
        ...classify({ backshift: 10 }),
        ...Array.from({ length: 10 }, () => ({ constructionId: null })),
      ],
      dismissedConstructionIds: new Set<string>(),
    });
    expect(result.status).toBe('enumeration-suspect');
    expect(result.missing).toEqual([]);
  });

  it('treats a fully unresolved cell as enumeration-suspect, not a finding', () => {
    const result = analyzeCell({
      constructions,
      classifications: Array.from({ length: 12 }, () => ({ constructionId: null })),
      dismissedConstructionIds: new Set<string>(),
    });
    expect(result.status).toBe('enumeration-suspect');
    expect(result.classified).toBe(0);
  });

  it('exposes the thresholds it enforces', () => {
    expect(FINDING_MAX_SHARE).toBe(0.05);
    expect(JUDGE_HEALTH_MAX_UNRESOLVED_SHARE).toBe(0.33);
  });
});
