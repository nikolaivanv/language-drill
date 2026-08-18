# Construction-Coverage Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `pnpm audit:constructions`, a read-only sweep that finds grammar points whose approved pool realizes only one of the constructions their description claims.

**Architecture:** A pure module (`packages/ai/src/construction-coverage.ts`) holds prompts, forced-tool schemas, parsers, deterministic sampling, and verdict logic. A CLI (`packages/ai/scripts/audit-constructions.ts`) is the only unit touching both `@language-drill/db` and Anthropic. A new dismissals ledger lives beside the curriculum in `packages/db`. Four stages: enumerate constructions per point → classify a deterministic per-cell sample → pure verdict → propose a fix snippet for confirmed findings.

**Tech Stack:** TypeScript, `tsx` CLI scripts, Vitest, Drizzle ORM, `@anthropic-ai/sdk` forced tool use.

**Spec:** `docs/superpowers/specs/2026-08-18-construction-coverage-audit-design.md`

## Global Constraints

- **`packages/ai` MUST NOT import `@language-drill/db`.** It causes a CI `TS2307` build cycle. The grammar point and all DB-derived data are passed *into* the pure module by the CLI. This also rules out importing `packages/db/scripts/p-limit.ts`.
- **Prompts are in-repo only.** Do NOT add these prompts to the `PROMPTS` manifest in `packages/ai/scripts/bootstrap-prompts.ts`. Author-run audits have no runtime fetch path. Precedent: `collapse-triage.ts`, `gloss-spoilage.ts`.
- **Version constant:** `CONSTRUCTION_COVERAGE_PROMPT_VERSION = 'construction-coverage@2026-08-18'`. Bump the date on any prompt edit in the same commit.
- **Read-only.** No `UPDATE`/`INSERT`/`DELETE` against `exercises` anywhere in this feature.
- **Model default:** `claude-sonnet-4-6` for all three prompts.
- **Thresholds:** `FINDING_MAX_SHARE = 0.05`, `JUDGE_HEALTH_MAX_UNRESOLVED_SHARE = 0.33`, default `--min-rows 8`, default `--sample-per-cell 24`, default `--max-cost-usd 2`.
- **Approved rows** are `review_status IN ('auto-approved', 'manual-approved')`.
- **In scope:** `ExerciseType.CLOZE` and `ExerciseType.TRANSLATION` only. Never `sentence_construction`.
- **Test command:** run per package — `pnpm --filter @language-drill/ai test`, `pnpm --filter @language-drill/db test`. A root `pnpm test` gets killed partway through on this machine.
- **No `--limit` flag.** Use `--max-points`. `--limit` already means rows in `revalidate:cloze` and cells in `backfill:variant-seeds`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/src/curriculum/construction-dismissals.ts` | Ledger of legitimately-rare constructions (create) |
| `packages/db/src/curriculum/construction-dismissals.test.ts` | Ledger shape invariants (create) |
| `packages/db/src/curriculum/index.ts` | Re-export ledger (modify) |
| `packages/db/src/index.ts` | Re-export ledger (modify) |
| `packages/ai/src/construction-coverage.ts` | Pure: types, `pLimit`, sampling, verdict, 3 prompts + tools + parsers + callers (create) |
| `packages/ai/src/construction-coverage.test.ts` | Unit tests for the above (create) |
| `packages/ai/src/index.ts` | Re-export the module's public surface (modify) |
| `packages/ai/scripts/audit-constructions.ts` | CLI: args, loading, orchestration, cost cap, report (create) |
| `packages/ai/scripts/audit-constructions.test.ts` | CLI unit tests (create) |
| `packages/ai/scripts/fixtures/construction-coverage-cases.json` | Hand-labelled acceptance cases (create) |
| `packages/ai/package.json` | `audit:constructions` script (modify) |
| `package.json` | Root passthrough script (modify) |
| `CLAUDE.md` | Command table row (modify) |
| `docs/curriculum-authoring.md` | Cross-reference to the detector (modify) |

---

### Task 1: Construction-dismissals ledger

A ledger recording "this construction is legitimately rare here", so a dismissed finding stops reappearing every run. Separate from `COLLAPSE_DISMISSALS`, which is keyed on a dominant *surface*.

**Files:**
- Create: `packages/db/src/curriculum/construction-dismissals.ts`
- Create: `packages/db/src/curriculum/construction-dismissals.test.ts`
- Modify: `packages/db/src/curriculum/index.ts` (append near line 455, beside the `collapse-dismissals` re-exports)
- Modify: `packages/db/src/index.ts` (append near line 56, beside the `collapse-dismissals` re-exports)

**Interfaces:**
- Consumes: `ExerciseType` from `@language-drill/shared`
- Produces: `ConstructionDismissal`, `CONSTRUCTION_DISMISSALS`, `findConstructionDismissal(key, type, constructionId): ConstructionDismissal | undefined`, `dismissedConstructionIds(key, type): Set<string>`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/curriculum/construction-dismissals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import {
  CONSTRUCTION_DISMISSALS,
  findConstructionDismissal,
  dismissedConstructionIds,
} from './construction-dismissals';

describe('CONSTRUCTION_DISMISSALS', () => {
  it('gives every entry a non-empty reason', () => {
    for (const d of CONSTRUCTION_DISMISSALS) {
      expect(d.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it('dates every entry as an ISO day', () => {
    for (const d of CONSTRUCTION_DISMISSALS) {
      expect(d.dismissedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('has no duplicate (point, type, constructionId) keys', () => {
    const keys = CONSTRUCTION_DISMISSALS.map(
      (d) => `${d.grammarPointKey}|${d.type}|${d.constructionId}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('findConstructionDismissal', () => {
  it('returns undefined for an unlisted construction', () => {
    expect(
      findConstructionDismissal('es-b1-reported-speech', ExerciseType.CLOZE, 'not-listed'),
    ).toBeUndefined();
  });
});

describe('dismissedConstructionIds', () => {
  it('returns an empty set for an unlisted cell', () => {
    expect(dismissedConstructionIds('es-b1-reported-speech', ExerciseType.CLOZE).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db test construction-dismissals`
Expected: FAIL — `Cannot find module './construction-dismissals'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/db/src/curriculum/construction-dismissals.ts`:

```ts
/**
 * Construction-dismissals ledger — every "this construction is legitimately
 * rare in this cell" judgement, recorded so `pnpm audit:constructions` stops
 * re-reporting it on every run.
 *
 * Lives beside the curriculum because that is what it describes: a dismissal is
 * a statement about a grammar point's pedagogy, not about the audit tool.
 *
 * Deliberately NOT an extension of `COLLAPSE_DISMISSALS`, which is keyed on a
 * dominant answer SURFACE. A dismissal here says a named sub-construction is
 * legitimately under-represented (a Spanish reporting verb that takes no tense
 * shift is genuinely uncommon). Overloading `surface: null` to mean "some
 * construction" would make both ledgers harder to read.
 *
 * Starts empty: entries are added as the audit's findings are reviewed and
 * judged correct-as-is.
 */

import { ExerciseType } from '@language-drill/shared';

export type ConstructionDismissal = Readonly<{
  grammarPointKey: string;
  type: ExerciseType;
  /** The `ClaimedConstruction.id` this dismissal covers. Never null — a
   *  blanket cell dismissal would hide a second, unrelated gap. */
  constructionId: string;
  /** Why the under-representation is correct. Non-empty; this is the whole value. */
  reason: string;
  /** ISO date (YYYY-MM-DD). Shown in the report so a stale dismissal is
   *  visible rather than silently permanent. */
  dismissedOn: string;
}>;

export const CONSTRUCTION_DISMISSALS: readonly ConstructionDismissal[] = Object.freeze([]);

/** The ledger entry accounting for this exact finding, or `undefined`. Returns
 *  the ENTRY so the report can render its `reason` and `dismissedOn` — a
 *  dismissal shown only as the word "ledger" is an unauditable filtered view. */
export function findConstructionDismissal(
  grammarPointKey: string,
  type: ExerciseType,
  constructionId: string,
): ConstructionDismissal | undefined {
  return CONSTRUCTION_DISMISSALS.find(
    (d) =>
      d.grammarPointKey === grammarPointKey &&
      d.type === type &&
      d.constructionId === constructionId,
  );
}

/** Every dismissed construction id for one cell, as the audit's pure verdict
 *  step consumes it. */
export function dismissedConstructionIds(
  grammarPointKey: string,
  type: ExerciseType,
): Set<string> {
  return new Set(
    CONSTRUCTION_DISMISSALS.filter(
      (d) => d.grammarPointKey === grammarPointKey && d.type === type,
    ).map((d) => d.constructionId),
  );
}
```

- [ ] **Step 4: Add the barrel re-exports**

In `packages/db/src/curriculum/index.ts`, directly after the existing `collapse-dismissals` exports (~line 456):

```ts
export {
  CONSTRUCTION_DISMISSALS,
  findConstructionDismissal,
  dismissedConstructionIds,
} from './construction-dismissals';
export type { ConstructionDismissal } from './construction-dismissals';
```

In `packages/db/src/index.ts`, directly after the existing `collapse-dismissals` exports (~line 57):

```ts
export {
  CONSTRUCTION_DISMISSALS,
  findConstructionDismissal,
  dismissedConstructionIds,
} from './curriculum/construction-dismissals';
export type { ConstructionDismissal } from './curriculum/construction-dismissals';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/db test construction-dismissals`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/curriculum/construction-dismissals.ts \
        packages/db/src/curriculum/construction-dismissals.test.ts \
        packages/db/src/curriculum/index.ts packages/db/src/index.ts
git commit -m "Add the construction-dismissals ledger"
```

---

### Task 2: Pure core — types, pLimit, deterministic sampling, verdict

**Files:**
- Create: `packages/ai/src/construction-coverage.ts`
- Create: `packages/ai/src/construction-coverage.test.ts`

**Interfaces:**
- Consumes: `ExerciseType` from `@language-drill/shared`
- Produces: `CONSTRUCTION_COVERAGE_PROMPT_VERSION`, `FINDING_MAX_SHARE`, `JUDGE_HEALTH_MAX_UNRESOLVED_SHARE`, `ClaimedConstruction`, `PointEnumeration`, `AuditRow`, `RowClassification`, `ConstructionCount`, `CellAnalysis`, `pLimit`, `sampleRowsForCell`, `analyzeCell`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/construction-coverage.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test construction-coverage`
Expected: FAIL — `Cannot find module './construction-coverage.js'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/ai/src/construction-coverage.ts`:

```ts
/**
 * Construction-coverage audit (2026-08-18 design). In-repo prompts + forced
 * tools + pure parsers, mirroring `collapse-triage.ts` and `gloss-spoilage.ts`.
 * NOT a runtime Lambda path and NOT registered in Langfuse — a dev-time aid run
 * by a human via the `audit:constructions` CLI. Do NOT add it to the PROMPTS
 * manifest in `bootstrap-prompts.ts`. Bump the version constant on prompt edits.
 *
 * Finds the defect neither the generator nor the validator can see: a point
 * whose description claims N constructions but whose approved pool realizes
 * one. `audit:collapse` cannot find it either — two of its three signals read
 * declared mechanisms that a spec-less point lacks by definition, and the other
 * two are lexical, so 45 rows of one construction over 45 different nouns look
 * diverse.
 *
 * This module holds NO db import (`ai` must not import `db` — CI TS2307). The
 * grammar point and every DB-derived value are passed in by the CLI.
 */

export const CONSTRUCTION_COVERAGE_PROMPT_VERSION = 'construction-coverage@2026-08-18';

/** A mustRepresent construction at or below this share of classified rows is a
 *  finding. At the default sample of 24 this means 0 or 1 row — the cliff is
 *  sharp by design: the defect being hunted is near-total absence, not mild
 *  skew (mild skew on a DECLARED mechanism is audit:collapse's variant-skew). */
export const FINDING_MAX_SHARE = 0.05;

/** Above this share of `none` + `unclear`, the honest reading is that the
 *  enumeration was wrong, not that the pool is collapsed. Such a cell reports
 *  as `enumeration-suspect` and produces NO finding — without this gate a bad
 *  stage-1 call manufactures a confident finding from every row it failed to
 *  understand. */
export const JUDGE_HEALTH_MAX_UNRESOLVED_SHARE = 0.33;

export type ClaimedConstruction = {
  /** kebab-case; reused as the proposed variant id in the proposal stage. */
  id: string;
  label: string;
  mustRepresent: boolean;
  rationale: string;
};

export type PointEnumeration = {
  grammarPointKey: string;
  constructions: ClaimedConstruction[];
  mechanism: 'construction-variants' | 'coverage-spec' | 'none';
};

/** One approved row as the CLI loads it. `content` is the raw `content_json`
 *  blob — deliberately untyped, since the audit reads legacy rows whose shape
 *  predates the current discriminated union. */
export type AuditRow = {
  id: string;
  content: Record<string, unknown>;
};

/** One classifier result. `constructionId: null` covers both `none` (the row
 *  realizes something not on the list) and `unclear`. */
export type RowClassification = {
  constructionId: string | null;
};

export type ConstructionCount = {
  id: string;
  label: string;
  mustRepresent: boolean;
  count: number;
  /** Of CLASSIFIED rows, not of sampled rows. */
  share: number;
};

export type CellAnalysis = {
  status: 'ok' | 'finding' | 'enumeration-suspect';
  /** Rows that resolved to a construction id. */
  classified: number;
  /** Rows that resolved to `none` or `unclear`. */
  unresolved: number;
  /** classified + unresolved — the report's denominator. */
  sampled: number;
  counts: ConstructionCount[];
  /** mustRepresent constructions at or below FINDING_MAX_SHARE, minus
   *  dismissals. Always empty unless `status === 'finding'`. */
  missing: ConstructionCount[];
};

/** Tiny inline concurrency limiter. A local copy rather than an import: the
 *  equivalent helper lives in `packages/db/scripts/p-limit.ts`, and `ai` must
 *  not depend on `db`. */
export type LimitFn = <T>(fn: () => Promise<T>) => Promise<T>;

export function pLimit(concurrency: number): LimitFn {
  if (concurrency < 1) throw new Error('pLimit: concurrency must be >= 1');
  let active = 0;
  const queue: Array<() => void> = [];

  const next = (): void => {
    if (active >= concurrency) return;
    const job = queue.shift();
    if (job) job();
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      };
      queue.push(run);
      next();
    });
}

/** FNV-1a. Small, dependency-free, and stable across Node versions — the
 *  sample must reproduce exactly from a `--seed`. */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic, spread sample of a cell's rows.
 *
 * Ordering by the row's own `created_at` (or by input order, which is the
 * same thing) would be wrong: consecutive rows come from the same generation
 * batch and share a prompt version, so a head-of-list sample measures one
 * batch's habits rather than the cell's. Hashing `(seed, id)` spreads the
 * sample across batches while staying reproducible.
 */
export function sampleRowsForCell<T extends { id: string }>(
  rows: readonly T[],
  seed: string,
  cap: number,
): T[] {
  if (rows.length <= cap) return [...rows];
  return [...rows]
    .map((row) => ({ row, h: hash32(`${seed}:${row.id}`) }))
    .sort((a, b) => (a.h === b.h ? a.row.id.localeCompare(b.row.id) : a.h - b.h))
    .slice(0, cap)
    .map((entry) => entry.row);
}

export type AnalyzeCellInput = {
  constructions: readonly ClaimedConstruction[];
  classifications: readonly RowClassification[];
  dismissedConstructionIds: ReadonlySet<string>;
};

/** Pure verdict. No LLM, no I/O. */
export function analyzeCell(input: AnalyzeCellInput): CellAnalysis {
  const { constructions, classifications, dismissedConstructionIds } = input;

  const sampled = classifications.length;
  const tally = new Map<string, number>();
  let unresolved = 0;
  for (const c of classifications) {
    if (c.constructionId === null) {
      unresolved++;
      continue;
    }
    tally.set(c.constructionId, (tally.get(c.constructionId) ?? 0) + 1);
  }
  const classified = sampled - unresolved;

  const counts: ConstructionCount[] = constructions.map((c) => {
    const count = tally.get(c.id) ?? 0;
    return {
      id: c.id,
      label: c.label,
      mustRepresent: c.mustRepresent,
      count,
      // Guard the divide: a fully unresolved cell is caught by the health gate
      // below, but must not produce NaN shares in the report on the way there.
      share: classified === 0 ? 0 : count / classified,
    };
  });

  if (sampled === 0 || unresolved / sampled > JUDGE_HEALTH_MAX_UNRESOLVED_SHARE) {
    return { status: 'enumeration-suspect', classified, unresolved, sampled, counts, missing: [] };
  }

  const missing = counts.filter(
    (c) =>
      c.mustRepresent &&
      c.share <= FINDING_MAX_SHARE &&
      !dismissedConstructionIds.has(c.id),
  );

  return {
    status: missing.length > 0 ? 'finding' : 'ok',
    classified,
    unresolved,
    sampled,
    counts,
    missing,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test construction-coverage`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/construction-coverage.ts packages/ai/src/construction-coverage.test.ts
git commit -m "Add the construction-coverage pure core: sampling and verdict"
```

---

### Task 3: Stage 1 — enumeration prompt, tool, parser, caller

The load-bearing prompt. Precision is front-loaded here rather than left to post-hoc triage: by triage time the only evidence left is a distribution, and a distribution cannot say whether the missing thing *mattered*.

**Files:**
- Modify: `packages/ai/src/construction-coverage.ts` (append)
- Modify: `packages/ai/src/construction-coverage.test.ts` (append)

**Interfaces:**
- Consumes: `ClaimedConstruction`, `PointEnumeration` (Task 2); `GrammarPoint` from `@language-drill/shared`; `Anthropic` type
- Produces: `CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT`, `ENUMERATION_TOOL_NAME`, `ENUMERATION_TOOL`, `buildEnumerationUserPrompt(gp)`, `parsePointEnumeration(input, key)`, `enumeratePointConstructions(client, gp, signal?)`

- [ ] **Step 1: Write the failing test**

Append to `packages/ai/src/construction-coverage.test.ts`:

```ts
import { vi } from 'vitest';
import type { GrammarPoint } from '@language-drill/shared';
import type Anthropic from '@anthropic-ai/sdk';
import {
  CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT,
  ENUMERATION_TOOL,
  ENUMERATION_TOOL_NAME,
  buildEnumerationUserPrompt,
  parsePointEnumeration,
  enumeratePointConstructions,
  CONSTRUCTION_COVERAGE_MODEL,
} from './construction-coverage.js';

const gp: GrammarPoint = {
  key: 'es-b1-reported-speech',
  kind: 'grammar',
  name: 'Reported speech (present-to-past)',
  description: 'Reporting what someone said with dijo que + imperfect, and reported commands with que + present subjunctive.',
  cefrLevel: 'B1',
  language: 'ES',
  examplesPositive: ['Dijo que estaba cansada.', 'Me dijo que viniera temprano.'],
  examplesNegative: ['*Dijo que está cansada.'],
  commonErrors: ['Failing to backshift the tense.'],
} as GrammarPoint;

describe('buildEnumerationUserPrompt', () => {
  it('includes the description and examples', () => {
    const prompt = buildEnumerationUserPrompt(gp);
    expect(prompt).toContain(gp.description);
    expect(prompt).toContain('Dijo que estaba cansada.');
  });

  // The spec's rule: stage 1 must enumerate what the point CLAIMS before
  // seeing what was built, or it rationalizes the existing distribution as
  // complete — the exact blindness that let 96/99 look fine.
  it('never mentions the pool', () => {
    const prompt = buildEnumerationUserPrompt(gp);
    expect(prompt.toLowerCase()).not.toContain('approved');
    expect(prompt.toLowerCase()).not.toContain('pool');
  });
});

describe('parsePointEnumeration', () => {
  const valid = {
    mechanism: 'construction-variants',
    constructions: [
      { id: 'backshift', label: 'dijo que + imperfect', mustRepresent: true, rationale: 'r' },
      { id: 'command', label: 'que + present subjunctive', mustRepresent: true, rationale: 'r' },
    ],
  };

  it('accepts a well-formed enumeration', () => {
    const parsed = parsePointEnumeration(valid, 'es-b1-reported-speech');
    expect(parsed.constructions).toHaveLength(2);
    expect(parsed.grammarPointKey).toBe('es-b1-reported-speech');
  });

  it('rejects a non-kebab-case id', () => {
    expect(() =>
      parsePointEnumeration(
        { ...valid, constructions: [{ ...valid.constructions[0], id: 'Back Shift' }] },
        'k',
      ),
    ).toThrow(/kebab-case/);
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      parsePointEnumeration(
        { ...valid, constructions: [valid.constructions[0], valid.constructions[0]] },
        'k',
      ),
    ).toThrow(/duplicate/);
  });

  it('rejects an unknown mechanism', () => {
    expect(() => parsePointEnumeration({ ...valid, mechanism: 'vibes' }, 'k')).toThrow(/mechanism/);
  });

  it('rejects a missing rationale', () => {
    expect(() =>
      parsePointEnumeration(
        { ...valid, constructions: [{ ...valid.constructions[0], rationale: '  ' }] },
        'k',
      ),
    ).toThrow(/rationale/);
  });

  it('accepts an empty construction list', () => {
    expect(parsePointEnumeration({ mechanism: 'none', constructions: [] }, 'k').constructions)
      .toEqual([]);
  });
});

describe('enumeratePointConstructions', () => {
  it('forces the tool and returns the parsed enumeration plus usage', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          input: {
            mechanism: 'construction-variants',
            constructions: [
              { id: 'backshift', label: 'a', mustRepresent: true, rationale: 'r' },
              { id: 'command', label: 'b', mustRepresent: true, rationale: 'r' },
            ],
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
      stop_reason: 'tool_use',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const { enumeration, usage } = await enumeratePointConstructions(client, gp);

    expect(enumeration.constructions).toHaveLength(2);
    expect(usage.input_tokens).toBe(100);
    const args = create.mock.calls[0][0];
    expect(args.model).toBe(CONSTRUCTION_COVERAGE_MODEL);
    expect(args.tool_choice).toEqual({ type: 'tool', name: ENUMERATION_TOOL_NAME });
    expect(args.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('throws when no tool_use block comes back', async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'nope' }],
          usage: { input_tokens: 1, output_tokens: 1 },
          stop_reason: 'end_turn',
        }),
      },
    } as unknown as Anthropic;

    await expect(enumeratePointConstructions(client, gp)).rejects.toThrow(/no tool_use/);
  });
});

describe('ENUMERATION_TOOL', () => {
  it('requires every field the parser enforces', () => {
    const props = ENUMERATION_TOOL.input_schema.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['constructions', 'mechanism']);
  });
});

describe('CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT', () => {
  it('states the three-part mustRepresent test', () => {
    expect(CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT).toContain('Distinct form');
    expect(CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT).toContain('Actually claimed');
    expect(CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT).toContain('Cell-realizable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test construction-coverage`
Expected: FAIL — `CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `packages/ai/src/construction-coverage.ts`:

```ts
import type Anthropic from '@anthropic-ai/sdk';
import type { GrammarPoint } from '@language-drill/shared';

export const CONSTRUCTION_COVERAGE_MODEL = 'claude-sonnet-4-6';
export const CONSTRUCTION_COVERAGE_MAX_TOKENS = 2048;
export const CONSTRUCTION_COVERAGE_TEMPERATURE = 0.2;

export const ENUMERATION_TOOL_NAME = 'report_claimed_constructions';

const MECHANISMS = ['construction-variants', 'coverage-spec', 'none'] as const;
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT = `You read one grammar point's authored description and enumerate the distinct constructions it claims to teach.

You are NOT shown the exercise pool. Enumerate what the point CLAIMS, not what you imagine was built — a later step counts how many exercises realize each of your constructions.

For each construction, decide \`mustRepresent\`. It is TRUE only when ALL THREE hold:

1. **Distinct form** — realizing it makes the learner produce a materially different structure, not merely a different word. A list of lexical variants of one pattern (hinein/herein/hinaus/heraus) is ONE construction, not four.
2. **Actually claimed** — the description or a positive example asserts it, rather than mentioning it in passing.
3. **Cell-realizable** — a single fill-in-the-blank or translate-this-sentence item can exercise it. Discourse-level phenomena spanning several sentences fail this test.

If any test fails, include the item with \`mustRepresent: false\` and say why in the rationale. Being listed is not the same as being load-bearing.

Then pick the \`mechanism\` that would fix an under-represented item:
- \`construction-variants\` — the items are distinct SUB-CONSTRUCTIONS (different structures the learner builds). Example: a reporting verb in the past forcing a tense backshift, versus a reported command taking the subjunctive.
- \`coverage-spec\` — the items are VALUES of one categorical axis (person, number, polarity, gender, case, a set of plural classes). One construction, varying along a dimension.
- \`none\` — the point teaches a single construction with no meaningful internal variation.

A point with fewer than two \`mustRepresent\` constructions is the common, healthy case. Do not manufacture a contrast to be helpful: a spurious construction sends a whole cell into an expensive classification pass and produces a false finding.

Call the ${ENUMERATION_TOOL_NAME} tool.`;

export function buildEnumerationUserPrompt(gp: GrammarPoint): string {
  return `Grammar point: ${gp.name} (${gp.key}, ${gp.language} ${gp.cefrLevel})
Description: ${gp.description}
Positive examples: ${gp.examplesPositive.join(' | ')}
Negative examples: ${gp.examplesNegative.join(' | ')}
Common errors: ${gp.commonErrors.join(' | ')}

Which distinct constructions does this point claim?`;
}

export const ENUMERATION_TOOL: Anthropic.Tool = {
  name: ENUMERATION_TOOL_NAME,
  description: "Report the distinct constructions one grammar point's description claims.",
  input_schema: {
    type: 'object' as const,
    properties: {
      mechanism: { type: 'string', enum: [...MECHANISMS] },
      constructions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'kebab-case, stable.' },
            label: { type: 'string', description: 'Short human-readable name.' },
            mustRepresent: { type: 'boolean' },
            rationale: { type: 'string', description: 'One sentence.' },
          },
          required: ['id', 'label', 'mustRepresent', 'rationale'],
        },
      },
    },
    required: ['mechanism', 'constructions'],
  },
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireNonEmptyString(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return v.trim();
}

/** Pure validator for the enumeration tool output. Throws on any illegality —
 *  the CLI catches per point and records the failure rather than aborting. */
export function parsePointEnumeration(input: unknown, grammarPointKey: string): PointEnumeration {
  if (!isObject(input)) throw new Error('enumeration must be an object');

  const mechanism = input.mechanism;
  if (typeof mechanism !== 'string' || !(MECHANISMS as readonly string[]).includes(mechanism)) {
    throw new Error(`unknown mechanism '${String(mechanism)}'`);
  }

  const raw = input.constructions;
  if (!Array.isArray(raw)) throw new Error('constructions must be an array');

  const seen = new Set<string>();
  const constructions: ClaimedConstruction[] = raw.map((entry) => {
    if (!isObject(entry)) throw new Error('each construction must be an object');
    const id = requireNonEmptyString(entry.id, 'id');
    if (!KEBAB_CASE.test(id)) throw new Error(`id '${id}' must be kebab-case`);
    if (seen.has(id)) throw new Error(`duplicate construction id '${id}'`);
    seen.add(id);
    if (typeof entry.mustRepresent !== 'boolean') {
      throw new Error('mustRepresent must be a boolean');
    }
    return {
      id,
      label: requireNonEmptyString(entry.label, 'label'),
      mustRepresent: entry.mustRepresent,
      rationale: requireNonEmptyString(entry.rationale, 'rationale'),
    };
  });

  return {
    grammarPointKey,
    constructions,
    mechanism: mechanism as PointEnumeration['mechanism'],
  };
}

/** Call Claude with the forced enumeration tool. The system prompt is
 *  cache-marked: a run enumerates ~312 points against an identical system
 *  block, so all but the first call are cheap. */
export async function enumeratePointConstructions(
  client: Anthropic,
  gp: GrammarPoint,
  signal?: AbortSignal,
  model: string = CONSTRUCTION_COVERAGE_MODEL,
): Promise<{ enumeration: PointEnumeration; usage: Anthropic.Usage }> {
  const response = await client.messages.create(
    {
      model,
      max_tokens: CONSTRUCTION_COVERAGE_MAX_TOKENS,
      system: [
        {
          type: 'text' as const,
          text: CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user' as const, content: buildEnumerationUserPrompt(gp) }],
      tools: [ENUMERATION_TOOL],
      tool_choice: { type: 'tool' as const, name: ENUMERATION_TOOL_NAME },
      temperature: CONSTRUCTION_COVERAGE_TEMPERATURE,
    },
    { signal },
  );
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error(
      `enumeratePointConstructions: no tool_use block (stop_reason ${response.stop_reason})`,
    );
  }
  return { enumeration: parsePointEnumeration(toolUse.input, gp.key), usage: response.usage };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test construction-coverage`
Expected: PASS (all Task 2 tests plus 13 new)

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/construction-coverage.ts packages/ai/src/construction-coverage.test.ts
git commit -m "Add the construction enumeration prompt and parser"
```

---

### Task 4: Stage 2 — batched row classification

**Files:**
- Modify: `packages/ai/src/construction-coverage.ts` (append)
- Modify: `packages/ai/src/construction-coverage.test.ts` (append)

**Interfaces:**
- Consumes: `ClaimedConstruction`, `AuditRow`, `RowClassification` (Task 2); `ExerciseType`
- Produces: `CLASSIFICATION_SYSTEM_PROMPT`, `CLASSIFICATION_TOOL_NAME`, `CLASSIFICATION_TOOL`, `rowSurfaceFor(type, content)`, `buildClassificationUserPrompt(input)`, `parseRowClassifications(input, batchSize, validIds)`, `classifyRowBatch(client, input, signal?)`, `DEFAULT_CLASSIFICATION_BATCH_SIZE`

- [ ] **Step 1: Write the failing test**

Append to `packages/ai/src/construction-coverage.test.ts`:

```ts
import { ExerciseType } from '@language-drill/shared';
import {
  CLASSIFICATION_SYSTEM_PROMPT,
  CLASSIFICATION_TOOL_NAME,
  rowSurfaceFor,
  buildClassificationUserPrompt,
  parseRowClassifications,
  classifyRowBatch,
  DEFAULT_CLASSIFICATION_BATCH_SIZE,
} from './construction-coverage.js';

describe('rowSurfaceFor', () => {
  it('renders a cloze as stem plus answer', () => {
    const s = rowSurfaceFor(ExerciseType.CLOZE, {
      sourceText: 'Dijo que ___ cansada.',
      correctAnswer: 'estaba',
    });
    expect(s).toContain('Dijo que ___ cansada.');
    expect(s).toContain('estaba');
  });

  it('renders a translation as source plus reference', () => {
    const s = rowSurfaceFor(ExerciseType.TRANSLATION, {
      sourceText: 'She said she was tired.',
      referenceTranslation: 'Dijo que estaba cansada.',
    });
    expect(s).toContain('She said she was tired.');
    expect(s).toContain('Dijo que estaba cansada.');
  });

  it('returns null when the fields are missing or not strings', () => {
    expect(rowSurfaceFor(ExerciseType.CLOZE, {})).toBeNull();
    expect(rowSurfaceFor(ExerciseType.CLOZE, { sourceText: 5, correctAnswer: 'x' })).toBeNull();
  });
});

describe('buildClassificationUserPrompt', () => {
  const constructions: ClaimedConstruction[] = [
    { id: 'backshift', label: 'dijo que + imperfect', mustRepresent: true, rationale: 'why' },
    { id: 'command', label: 'que + present subjunctive', mustRepresent: true, rationale: 'why' },
  ];

  it('lists the rows with 1-based indices', () => {
    const prompt = buildClassificationUserPrompt({
      constructions,
      type: ExerciseType.CLOZE,
      rows: [
        { id: 'a', content: { sourceText: 'x ___', correctAnswer: 'y' } },
        { id: 'b', content: { sourceText: 'p ___', correctAnswer: 'q' } },
      ],
    });
    expect(prompt).toContain('1.');
    expect(prompt).toContain('2.');
  });

  // The spec: the classifier sees only the labels, so it classifies what a row
  // IS rather than what the enumerator hoped to find.
  it('does not leak the enumerator rationale', () => {
    const prompt = buildClassificationUserPrompt({
      constructions,
      type: ExerciseType.CLOZE,
      rows: [{ id: 'a', content: { sourceText: 'x ___', correctAnswer: 'y' } }],
    });
    expect(prompt).not.toContain('why');
  });
});

describe('parseRowClassifications', () => {
  const validIds = new Set(['backshift', 'command']);

  it('maps ids through and nulls out none/unclear', () => {
    const parsed = parseRowClassifications(
      {
        classifications: [
          { index: 1, constructionId: 'backshift' },
          { index: 2, constructionId: 'none' },
          { index: 3, constructionId: 'unclear' },
        ],
      },
      3,
      validIds,
    );
    expect(parsed.map((p) => p.constructionId)).toEqual(['backshift', null, null]);
  });

  it('nulls out an id that was never enumerated rather than trusting it', () => {
    const parsed = parseRowClassifications(
      { classifications: [{ index: 1, constructionId: 'invented' }] },
      1,
      validIds,
    );
    expect(parsed[0].constructionId).toBeNull();
  });

  it('nulls out any row the model omitted', () => {
    const parsed = parseRowClassifications(
      { classifications: [{ index: 1, constructionId: 'backshift' }] },
      3,
      validIds,
    );
    expect(parsed).toHaveLength(3);
    expect(parsed[1].constructionId).toBeNull();
    expect(parsed[2].constructionId).toBeNull();
  });

  it('rejects an out-of-range index', () => {
    expect(() =>
      parseRowClassifications({ classifications: [{ index: 9, constructionId: 'backshift' }] }, 3, validIds),
    ).toThrow(/index/);
  });
});

describe('classifyRowBatch', () => {
  it('forces the tool and returns classifications plus usage', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          input: { classifications: [{ index: 1, constructionId: 'backshift' }] },
        },
      ],
      usage: { input_tokens: 200, output_tokens: 30 },
      stop_reason: 'tool_use',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const { classifications, usage } = await classifyRowBatch(client, {
      constructions: [
        { id: 'backshift', label: 'a', mustRepresent: true, rationale: 'r' },
      ],
      type: ExerciseType.CLOZE,
      rows: [{ id: 'a', content: { sourceText: 'x ___', correctAnswer: 'y' } }],
    });

    expect(classifications).toEqual([{ constructionId: 'backshift' }]);
    expect(usage.output_tokens).toBe(30);
    expect(create.mock.calls[0][0].tool_choice).toEqual({
      type: 'tool',
      name: CLASSIFICATION_TOOL_NAME,
    });
  });
});

describe('CLASSIFICATION_SYSTEM_PROMPT', () => {
  it('offers none and unclear as escape hatches', () => {
    expect(CLASSIFICATION_SYSTEM_PROMPT).toContain('none');
    expect(CLASSIFICATION_SYSTEM_PROMPT).toContain('unclear');
  });

  it('batches at a size that keeps the system block cacheable', () => {
    expect(DEFAULT_CLASSIFICATION_BATCH_SIZE).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test construction-coverage`
Expected: FAIL — `rowSurfaceFor` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `packages/ai/src/construction-coverage.ts`:

```ts
import { ExerciseType } from '@language-drill/shared';

export const CLASSIFICATION_TOOL_NAME = 'report_row_constructions';
export const DEFAULT_CLASSIFICATION_BATCH_SIZE = 20;

/** The escape hatches. Both collapse to `constructionId: null` — the verdict
 *  step only needs "did this row resolve", and separating them would imply a
 *  precision the classifier does not have. */
const UNRESOLVED_IDS = new Set(['none', 'unclear']);

/**
 * The learner-visible surface of a row, per exercise type. Returns null when
 * the row is malformed — a defensive skip beats a crash on one legacy row.
 */
export function rowSurfaceFor(
  type: ExerciseType,
  content: Record<string, unknown>,
): string | null {
  if (type === ExerciseType.CLOZE) {
    const stem = content.sourceText;
    const answer = content.correctAnswer;
    if (typeof stem !== 'string' || typeof answer !== 'string') return null;
    return `${stem}   [answer: ${answer}]`;
  }
  if (type === ExerciseType.TRANSLATION) {
    const source = content.sourceText;
    const reference = content.referenceTranslation;
    if (typeof source !== 'string' || typeof reference !== 'string') return null;
    return `${source}   [reference: ${reference}]`;
  }
  return null;
}

export const CLASSIFICATION_SYSTEM_PROMPT = `You classify pre-generated language exercises by which construction each one realizes.

You are given a numbered list of constructions and a numbered list of exercises. For EVERY exercise, return the id of the single construction it realizes.

Two escape hatches, and using them honestly matters more than covering every row:
- \`none\` — the exercise realizes some other construction of this grammar point that is not on the list.
- \`unclear\` — the exercise is ambiguous between two listed constructions, or too short to tell.

Do not stretch an exercise to fit a listed construction. A high rate of \`none\` is a useful signal that the construction list is wrong, and it is read as exactly that downstream — guessing to look decisive destroys that signal.

Judge only what the exercise actually contains. Call the ${CLASSIFICATION_TOOL_NAME} tool with one entry per exercise.`;

export type ClassificationInput = {
  constructions: readonly ClaimedConstruction[];
  type: ExerciseType;
  rows: readonly AuditRow[];
};

export function buildClassificationUserPrompt(input: ClassificationInput): string {
  // Labels only — never the enumerator's rationale, so the classifier reads
  // what a row IS rather than what the enumerator hoped to find.
  const list = input.constructions.map((c) => `- ${c.id}: ${c.label}`).join('\n');
  const rows = input.rows
    .map((r, i) => `${i + 1}. ${rowSurfaceFor(input.type, r.content) ?? '(unreadable row)'}`)
    .join('\n');
  return `Constructions:
${list}

Exercises (${input.type}):
${rows}

Classify every exercise.`;
}

export const CLASSIFICATION_TOOL: Anthropic.Tool = {
  name: CLASSIFICATION_TOOL_NAME,
  description: 'Report which construction each exercise realizes.',
  input_schema: {
    type: 'object' as const,
    properties: {
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', description: '1-based index of the exercise.' },
            constructionId: {
              type: 'string',
              description: "A listed construction id, or 'none', or 'unclear'.",
            },
          },
          required: ['index', 'constructionId'],
        },
      },
    },
    required: ['classifications'],
  },
};

/**
 * Pure validator. Returns exactly `batchSize` entries in input order.
 *
 * An id the enumeration never produced is normalised to null rather than
 * trusted: a hallucinated id would otherwise inflate a construction's count
 * and mask the very absence being measured. Omitted rows are likewise null —
 * a silently short answer must not shrink the denominator.
 */
export function parseRowClassifications(
  input: unknown,
  batchSize: number,
  validIds: ReadonlySet<string>,
): RowClassification[] {
  if (!isObject(input)) throw new Error('classification result must be an object');
  const raw = input.classifications;
  if (!Array.isArray(raw)) throw new Error('classifications must be an array');

  const out: RowClassification[] = Array.from({ length: batchSize }, () => ({
    constructionId: null,
  }));

  for (const entry of raw) {
    if (!isObject(entry)) throw new Error('each classification must be an object');
    const index = entry.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 1 || index > batchSize) {
      throw new Error(`classification index ${String(index)} out of range 1..${batchSize}`);
    }
    const id = entry.constructionId;
    if (typeof id !== 'string') throw new Error('constructionId must be a string');
    out[index - 1] = {
      constructionId: UNRESOLVED_IDS.has(id) || !validIds.has(id) ? null : id,
    };
  }

  return out;
}

/** Call Claude with the forced classification tool for one batch of rows. */
export async function classifyRowBatch(
  client: Anthropic,
  input: ClassificationInput,
  signal?: AbortSignal,
): Promise<{ classifications: RowClassification[]; usage: Anthropic.Usage }> {
  const response = await client.messages.create(
    {
      model: CONSTRUCTION_COVERAGE_MODEL,
      max_tokens: CONSTRUCTION_COVERAGE_MAX_TOKENS,
      system: [
        {
          type: 'text' as const,
          text: CLASSIFICATION_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user' as const, content: buildClassificationUserPrompt(input) }],
      tools: [CLASSIFICATION_TOOL],
      tool_choice: { type: 'tool' as const, name: CLASSIFICATION_TOOL_NAME },
      temperature: CONSTRUCTION_COVERAGE_TEMPERATURE,
    },
    { signal },
  );
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error(`classifyRowBatch: no tool_use block (stop_reason ${response.stop_reason})`);
  }
  const validIds = new Set(input.constructions.map((c) => c.id));
  return {
    classifications: parseRowClassifications(toolUse.input, input.rows.length, validIds),
    usage: response.usage,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test construction-coverage`
Expected: PASS (all prior tests plus 13 new)

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/construction-coverage.ts packages/ai/src/construction-coverage.test.ts
git commit -m "Add batched row classification against enumerated constructions"
```

---

### Task 5: Stage 4 — fix proposal

Runs only on confirmed findings. Kept separate from stage 1 deliberately: enumerating constructions in order to *count* them is a different job from authoring a directive a generator must obey.

**Files:**
- Modify: `packages/ai/src/construction-coverage.ts` (append)
- Modify: `packages/ai/src/construction-coverage.test.ts` (append)
- Modify: `packages/ai/src/index.ts` (append re-exports)

**Interfaces:**
- Consumes: `PointEnumeration`, `ConstructionCount`, `CONSTRUCTION_COVERAGE_MODEL`
- Produces: `PROPOSAL_TOOL_NAME`, `PROPOSAL_TOOL`, `PROPOSAL_SYSTEM_PROMPT`, `buildProposalUserPrompt(input)`, `parseMechanismProposal(input)`, `proposeMechanism(client, input, signal?)`, `MechanismProposal`

- [ ] **Step 1: Write the failing test**

Append to `packages/ai/src/construction-coverage.test.ts`:

```ts
import {
  PROPOSAL_TOOL_NAME,
  buildProposalUserPrompt,
  parseMechanismProposal,
  proposeMechanism,
} from './construction-coverage.js';

const proposalInput = {
  grammarPoint: gp,
  mechanism: 'construction-variants' as const,
  counts: [
    { id: 'backshift', label: 'dijo que + imperfect', mustRepresent: true, count: 23, share: 0.96 },
    { id: 'command', label: 'que + present subjunctive', mustRepresent: true, count: 1, share: 0.04 },
  ],
  sampled: 24,
};

describe('buildProposalUserPrompt', () => {
  it('shows each construction with its measured realized count', () => {
    const prompt = buildProposalUserPrompt(proposalInput);
    expect(prompt).toContain('23');
    expect(prompt).toContain('1');
    expect(prompt).toContain('24');
  });
});

describe('parseMechanismProposal', () => {
  it('accepts a construction-variants proposal', () => {
    const parsed = parseMechanismProposal({
      mechanism: 'construction-variants',
      snippet: 'constructionVariants: [...]',
      notes: 'Split by reporting-verb tense zone.',
    });
    expect(parsed.mechanism).toBe('construction-variants');
    expect(parsed.snippet).toContain('constructionVariants');
  });

  it('rejects an empty snippet', () => {
    expect(() =>
      parseMechanismProposal({ mechanism: 'coverage-spec', snippet: '  ', notes: 'n' }),
    ).toThrow(/snippet/);
  });

  it('rejects the none mechanism — there is nothing to propose', () => {
    expect(() =>
      parseMechanismProposal({ mechanism: 'none', snippet: 'x', notes: 'n' }),
    ).toThrow(/mechanism/);
  });
});

describe('proposeMechanism', () => {
  it('forces the proposal tool', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          input: {
            mechanism: 'construction-variants',
            snippet: 'constructionVariants: [...]',
            notes: 'n',
          },
        },
      ],
      usage: { input_tokens: 300, output_tokens: 200 },
      stop_reason: 'tool_use',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const { proposal } = await proposeMechanism(client, proposalInput);

    expect(proposal.snippet).toContain('constructionVariants');
    expect(create.mock.calls[0][0].tool_choice).toEqual({
      type: 'tool',
      name: PROPOSAL_TOOL_NAME,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test construction-coverage`
Expected: FAIL — `PROPOSAL_TOOL_NAME` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `packages/ai/src/construction-coverage.ts`:

```ts
export const PROPOSAL_TOOL_NAME = 'report_mechanism_proposal';

const PROPOSABLE_MECHANISMS = ['construction-variants', 'coverage-spec'] as const;

export type MechanismProposal = {
  mechanism: (typeof PROPOSABLE_MECHANISMS)[number];
  /** Paste-ready TypeScript fragment for the curriculum entry. */
  snippet: string;
  notes: string;
};

export const PROPOSAL_SYSTEM_PROMPT = `You author a fix for a grammar point whose exercise pool has been measured as covering only some of the constructions the point teaches.

You are given the point, the constructions it claims, and how many sampled exercises realize each. Produce a paste-ready TypeScript fragment for the curriculum entry.

For \`construction-variants\`, emit a \`constructionVariants\` array. Each entry needs:
- \`id\` — kebab-case, stable. Reuse the ids you are given; renaming one resets that variant's measured coverage.
- \`directive\` — strict prompt text naming the sub-construction, with a concrete exemplar. This is injected verbatim into the generation prompt, so it must be an instruction a generator can follow, not a description of the grammar.
- \`share\` — relative weight. Give the prototypical construction a plurality without letting it own the pool; a share of 3 against three share-1 variants targets 50%.

For \`coverage-spec\`, emit a \`coverageSpec\` fragment with one or two axes and an absolute minimum approved-count floor per value. Floors are absolute counts, not percentages.

Keep the snippet minimal — only the fields being added. A human reviews and commits it.`;

export type ProposalInput = {
  grammarPoint: GrammarPoint;
  mechanism: (typeof PROPOSABLE_MECHANISMS)[number];
  counts: readonly ConstructionCount[];
  sampled: number;
};

export function buildProposalUserPrompt(input: ProposalInput): string {
  const { grammarPoint: gp } = input;
  const rows = input.counts
    .map(
      (c) =>
        `- ${c.id} (${c.label}) — realized ${c.count}/${input.sampled} sampled` +
        `${c.mustRepresent ? '' : ' [not load-bearing]'}`,
    )
    .join('\n');
  return `Grammar point: ${gp.name} (${gp.key}, ${gp.language} ${gp.cefrLevel})
Description: ${gp.description}
Positive examples: ${gp.examplesPositive.join(' | ')}

Measured coverage:
${rows}

Recommended mechanism: ${input.mechanism}

Author the fix.`;
}

export const PROPOSAL_TOOL: Anthropic.Tool = {
  name: PROPOSAL_TOOL_NAME,
  description: 'Report a paste-ready curriculum fragment fixing a coverage gap.',
  input_schema: {
    type: 'object' as const,
    properties: {
      mechanism: { type: 'string', enum: [...PROPOSABLE_MECHANISMS] },
      snippet: { type: 'string', description: 'Paste-ready TypeScript fragment.' },
      notes: { type: 'string', description: 'One or two sentences for the reviewer.' },
    },
    required: ['mechanism', 'snippet', 'notes'],
  },
};

export function parseMechanismProposal(input: unknown): MechanismProposal {
  if (!isObject(input)) throw new Error('proposal must be an object');
  const mechanism = input.mechanism;
  if (
    typeof mechanism !== 'string' ||
    !(PROPOSABLE_MECHANISMS as readonly string[]).includes(mechanism)
  ) {
    throw new Error(`mechanism '${String(mechanism)}' is not proposable`);
  }
  return {
    mechanism: mechanism as MechanismProposal['mechanism'],
    snippet: requireNonEmptyString(input.snippet, 'snippet'),
    notes: requireNonEmptyString(input.notes, 'notes'),
  };
}

export async function proposeMechanism(
  client: Anthropic,
  input: ProposalInput,
  signal?: AbortSignal,
): Promise<{ proposal: MechanismProposal; usage: Anthropic.Usage }> {
  const response = await client.messages.create(
    {
      model: CONSTRUCTION_COVERAGE_MODEL,
      max_tokens: CONSTRUCTION_COVERAGE_MAX_TOKENS,
      system: [
        {
          type: 'text' as const,
          text: PROPOSAL_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user' as const, content: buildProposalUserPrompt(input) }],
      tools: [PROPOSAL_TOOL],
      tool_choice: { type: 'tool' as const, name: PROPOSAL_TOOL_NAME },
      temperature: CONSTRUCTION_COVERAGE_TEMPERATURE,
    },
    { signal },
  );
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error(`proposeMechanism: no tool_use block (stop_reason ${response.stop_reason})`);
  }
  return { proposal: parseMechanismProposal(toolUse.input), usage: response.usage };
}
```

- [ ] **Step 4: Re-export from the package barrel**

Append to `packages/ai/src/index.ts`:

```ts
// ---------------------------------------------------------------------------
// Construction-coverage audit (2026-08-18 design) — dev-time, not a runtime path
// ---------------------------------------------------------------------------

export {
  CONSTRUCTION_COVERAGE_PROMPT_VERSION,
  CONSTRUCTION_COVERAGE_MODEL,
  FINDING_MAX_SHARE,
  JUDGE_HEALTH_MAX_UNRESOLVED_SHARE,
  DEFAULT_CLASSIFICATION_BATCH_SIZE,
  CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT,
  CLASSIFICATION_SYSTEM_PROMPT,
  PROPOSAL_SYSTEM_PROMPT,
  pLimit,
  sampleRowsForCell,
  analyzeCell,
  rowSurfaceFor,
  enumeratePointConstructions,
  classifyRowBatch,
  proposeMechanism,
  parsePointEnumeration,
  parseRowClassifications,
  parseMechanismProposal,
} from './construction-coverage.js';

export type {
  ClaimedConstruction,
  PointEnumeration,
  AuditRow as ConstructionAuditRow,
  RowClassification,
  ConstructionCount,
  CellAnalysis,
  MechanismProposal,
} from './construction-coverage.js';
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @language-drill/ai test construction-coverage && pnpm --filter @language-drill/ai typecheck`
Expected: PASS, and typecheck clean

> Note: `AuditRow` is re-exported as `ConstructionAuditRow` because `collapse-metrics.ts` already exports an `AuditRow` from the same barrel. Exporting both unaliased is a duplicate-identifier error.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/construction-coverage.ts packages/ai/src/construction-coverage.test.ts packages/ai/src/index.ts
git commit -m "Add the mechanism-proposal stage and barrel exports"
```

---

### Task 6: CLI — args, loading, cell grouping, dry-run estimate

**Files:**
- Create: `packages/ai/scripts/audit-constructions.ts`
- Create: `packages/ai/scripts/audit-constructions.test.ts`
- Modify: `packages/ai/package.json`
- Modify: `package.json` (root)

**Interfaces:**
- Consumes: Task 2–5 exports; `createDb`, `exercises`, `ALL_CURRICULA`, `getGrammarPoint`, `dismissedConstructionIds`, `requireEnv` from `@language-drill/db`
- Produces: `AuditConstructionsFilters`, `parseAuditConstructionsArgs(argv)`, `LoadedRow`, `loadApprovedRows(db, filters)`, `groupRowsIntoCells(rows)`, `Cell`, `selectPoints(filters)`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/scripts/audit-constructions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import {
  parseAuditConstructionsArgs,
  groupRowsIntoCells,
} from './audit-constructions.js';

describe('parseAuditConstructionsArgs', () => {
  it('defaults the knobs to the spec values', () => {
    const f = parseAuditConstructionsArgs([]);
    expect(f.minRows).toBe(8);
    expect(f.samplePerCell).toBe(24);
    expect(f.maxCostUsd).toBe(2);
    expect(f.concurrency).toBe(4);
    expect(f.dryRun).toBe(false);
    expect(f.seed).toBe('default');
  });

  it('parses the filters', () => {
    const f = parseAuditConstructionsArgs([
      '--language', 'ES', '--cefr', 'B1', '--grammar-point', 'es-b1-reported-speech',
      '--max-points', '5', '--seed', 'abc', '--dry-run',
    ]);
    expect(f.language).toBe('ES');
    expect(f.cefr).toBe('B1');
    expect(f.grammarPoint).toBe('es-b1-reported-speech');
    expect(f.maxPoints).toBe(5);
    expect(f.seed).toBe('abc');
    expect(f.dryRun).toBe(true);
  });

  // The spec forbids a --limit alias: it already means rows in
  // revalidate:cloze and cells in backfill:variant-seeds.
  it('rejects --limit outright rather than guessing what it means', () => {
    expect(() => parseAuditConstructionsArgs(['--limit', '5'])).toThrow(/--max-points/);
  });

  it('rejects a non-positive --max-points', () => {
    expect(() => parseAuditConstructionsArgs(['--max-points', '0'])).toThrow(/max-points/);
  });

  it('rejects a sentence_construction type — out of scope', () => {
    expect(() => parseAuditConstructionsArgs(['--type', 'sentence_construction'])).toThrow(
      /cloze|translation/,
    );
  });
});

describe('groupRowsIntoCells', () => {
  it('groups by (grammarPointKey, type) and skips rows missing either', () => {
    const cells = groupRowsIntoCells([
      { id: '1', type: ExerciseType.CLOZE, grammarPointKey: 'p', contentJson: {} },
      { id: '2', type: ExerciseType.CLOZE, grammarPointKey: 'p', contentJson: {} },
      { id: '3', type: ExerciseType.TRANSLATION, grammarPointKey: 'p', contentJson: {} },
      { id: '4', type: ExerciseType.CLOZE, grammarPointKey: null, contentJson: {} },
    ]);
    expect(cells).toHaveLength(2);
    const cloze = cells.find((c) => c.type === ExerciseType.CLOZE);
    expect(cloze?.rows).toHaveLength(2);
    expect(cloze?.cellKey).toBe('p:cloze');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test audit-constructions`
Expected: FAIL — `Cannot find module './audit-constructions.js'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/ai/scripts/audit-constructions.ts`:

```ts
/**
 * packages/ai — audit:constructions CLI. Finds grammar points whose approved
 * pool realizes only some of the constructions their description claims: the
 * PR #664 defect class, which `audit:collapse` cannot see because two of its
 * three signals read declared mechanisms a spec-less point lacks by definition
 * and the other two are lexical.
 *
 * READ-ONLY on the database. Author-run; a spotlight, not a gate.
 *
 * Usage:
 *   pnpm audit:constructions --dry-run
 *   pnpm audit:constructions --language ES --cefr B1 --max-cost-usd 2
 */

import { parseArgs } from 'node:util';

import { ExerciseType } from '@language-drill/shared';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { createDb, exercises } from '@language-drill/db';

const IN_SCOPE_TYPES = [ExerciseType.CLOZE, ExerciseType.TRANSLATION] as const;

export type AuditConstructionsFilters = {
  language?: string;
  cefr?: string;
  grammarPoint?: string;
  type?: string;
  maxPoints?: number;
  minRows: number;
  samplePerCell: number;
  seed: string;
  maxCostUsd: number;
  concurrency: number;
  enumerationModel?: string;
  out?: string;
  dryRun: boolean;
  checkFixture: boolean;
};

function positiveInt(raw: string | undefined, flag: string, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${flag} must be a positive integer, got '${raw}'`);
  }
  return n;
}

export function parseAuditConstructionsArgs(argv: string[]): AuditConstructionsFilters {
  // `--limit` is deliberately declared so it can be REJECTED with a pointer to
  // --max-points. It already means rows in revalidate:cloze and cells in
  // backfill:variant-seeds; silently accepting a third meaning deepens a trap.
  const { values } = parseArgs({
    args: argv,
    options: {
      language: { type: 'string' },
      cefr: { type: 'string' },
      'grammar-point': { type: 'string' },
      type: { type: 'string' },
      'max-points': { type: 'string' },
      limit: { type: 'string' },
      'min-rows': { type: 'string' },
      'sample-per-cell': { type: 'string' },
      seed: { type: 'string' },
      'max-cost-usd': { type: 'string' },
      concurrency: { type: 'string' },
      'enumeration-model': { type: 'string' },
      out: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'check-fixture': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(
      'Usage: audit:constructions [--language ES] [--cefr B1] [--grammar-point <key>]\n' +
        '                          [--type cloze|translation] [--max-points N]\n' +
        '                          [--min-rows 8] [--sample-per-cell 24] [--seed <s>]\n' +
        '                          [--max-cost-usd 2] [--concurrency 4]\n' +
        '                          [--enumeration-model <id>] [--out <path>]\n' +
        '                          [--dry-run] [--check-fixture]\n\n' +
        '--dry-run makes NO API calls and costs nothing.',
    );
    process.exit(0);
  }

  if (values.limit !== undefined) {
    throw new Error(
      "--limit is not supported (it means rows in revalidate:cloze and cells in " +
        'backfill:variant-seeds). Use --max-points.',
    );
  }

  if (values.type !== undefined && !(IN_SCOPE_TYPES as readonly string[]).includes(values.type)) {
    throw new Error(`--type must be cloze or translation, got '${values.type}'`);
  }

  const maxCostRaw = values['max-cost-usd'];
  const maxCostUsd = maxCostRaw === undefined ? 2 : Number(maxCostRaw);
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    throw new Error(`--max-cost-usd must be a positive number, got '${String(maxCostRaw)}'`);
  }

  return {
    language: values.language,
    cefr: values.cefr,
    grammarPoint: values['grammar-point'],
    type: values.type,
    maxPoints:
      values['max-points'] === undefined
        ? undefined
        : positiveInt(values['max-points'], '--max-points', 1),
    minRows: positiveInt(values['min-rows'], '--min-rows', 8),
    samplePerCell: positiveInt(values['sample-per-cell'], '--sample-per-cell', 24),
    seed: values.seed ?? 'default',
    maxCostUsd,
    concurrency: positiveInt(values.concurrency, '--concurrency', 4),
    enumerationModel: values['enumeration-model'],
    out: values.out,
    dryRun: values['dry-run'] ?? false,
    checkFixture: values['check-fixture'] ?? false,
  };
}

export type LoadedRow = {
  id: string;
  type: string | null;
  grammarPointKey: string | null;
  contentJson: Record<string, unknown> | null;
};

export type Cell = {
  cellKey: string;
  grammarPointKey: string;
  type: ExerciseType;
  rows: Array<{ id: string; content: Record<string, unknown> }>;
};

/** Read-only. Mirrors audit-collapse.ts's loadApprovedRows shape. */
export async function loadApprovedRows(
  db: ReturnType<typeof createDb>,
  filters: AuditConstructionsFilters,
): Promise<LoadedRow[]> {
  const conditions = [
    inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
    isNotNull(exercises.grammarPointKey),
    inArray(exercises.type, [...IN_SCOPE_TYPES]),
  ];
  if (filters.language) conditions.push(eq(exercises.language, filters.language));
  if (filters.cefr) conditions.push(eq(exercises.difficulty, filters.cefr));
  if (filters.type) conditions.push(eq(exercises.type, filters.type));
  if (filters.grammarPoint) {
    conditions.push(eq(exercises.grammarPointKey, filters.grammarPoint));
  }

  const rows = await db
    .select({
      id: exercises.id,
      type: exercises.type,
      grammarPointKey: exercises.grammarPointKey,
      contentJson: exercises.contentJson,
    })
    .from(exercises)
    .where(and(...conditions));

  return rows as LoadedRow[];
}

export function groupRowsIntoCells(rows: readonly LoadedRow[]): Cell[] {
  const byKey = new Map<string, Cell>();
  for (const row of rows) {
    if (!row.grammarPointKey || !row.type) continue;
    if (!(IN_SCOPE_TYPES as readonly string[]).includes(row.type)) continue;
    const cellKey = `${row.grammarPointKey}:${row.type}`;
    let cell = byKey.get(cellKey);
    if (!cell) {
      cell = {
        cellKey,
        grammarPointKey: row.grammarPointKey,
        type: row.type as ExerciseType,
        rows: [],
      };
      byKey.set(cellKey, cell);
    }
    cell.rows.push({ id: row.id, content: row.contentJson ?? {} });
  }
  return [...byKey.values()].sort((a, b) => a.cellKey.localeCompare(b.cellKey));
}
```

- [ ] **Step 4: Wire the package scripts**

In `packages/ai/package.json`, add to `scripts` beside `audit:gloss`:

```json
"audit:constructions": "tsx scripts/audit-constructions.ts"
```

In the root `package.json`, add beside `audit:collapse`:

```json
"audit:constructions": "dotenv -e .env -- pnpm --filter @language-drill/ai audit:constructions"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test audit-constructions`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/ai/scripts/audit-constructions.ts packages/ai/scripts/audit-constructions.test.ts \
        packages/ai/package.json package.json
git commit -m "Add the audit:constructions CLI skeleton: args, loading, cell grouping"
```

---

### Task 7: CLI orchestration, cost cap, and report

**Files:**
- Modify: `packages/ai/scripts/audit-constructions.ts` (append)
- Modify: `packages/ai/scripts/audit-constructions.test.ts` (append)

**Interfaces:**
- Consumes: Task 6 exports; Task 2–5 module exports; `ALL_CURRICULA`, `getGrammarPoint`, `dismissedConstructionIds`, `requireEnv`, `createClaudeClient`
- Produces: `ConstructionFinding`, `ConstructionAuditReport`, `renderConstructionsMarkdown(report)`, `estimateCallCostUsd(usage)`, `selectPoints(filters)`, `runAudit(...)`

- [ ] **Step 1: Write the failing test**

Append to `packages/ai/scripts/audit-constructions.test.ts`:

```ts
import {
  renderConstructionsMarkdown,
  estimateCallCostUsd,
  rankFindings,
  type ConstructionAuditReport,
} from './audit-constructions.js';

const baseReport: ConstructionAuditReport = {
  runName: 'test-run',
  promptVersion: 'construction-coverage@2026-08-18',
  seed: 'default',
  samplePerCell: 24,
  partial: false,
  stoppedReason: null,
  summary: {
    pointsEnumerated: 2,
    pointsSingleConstruction: 1,
    cellsClassified: 1,
    rowsSampled: 24,
    findings: 1,
    enumerationSuspect: 0,
    dismissed: 0,
    thinCellsSkipped: 1,
    enumerationErrors: 0,
    costUsd: 0.42,
  },
  findings: [
    {
      cellKey: 'es-b1-reported-speech:cloze',
      grammarPointKey: 'es-b1-reported-speech',
      grammarPointName: 'Reported speech',
      type: 'cloze',
      language: 'ES',
      cefrLevel: 'B1',
      mechanism: 'construction-variants',
      sampled: 24,
      classified: 24,
      unresolved: 0,
      missing: [
        { id: 'command', label: 'que + present subjunctive', mustRepresent: true, count: 1, share: 0.0416 },
      ],
      counts: [
        { id: 'backshift', label: 'dijo que + imperfect', mustRepresent: true, count: 23, share: 0.958 },
        { id: 'command', label: 'que + present subjunctive', mustRepresent: true, count: 1, share: 0.0416 },
      ],
      proposal: { mechanism: 'construction-variants', snippet: 'constructionVariants: [...]', notes: 'n' },
    },
  ],
  enumerationSuspect: [],
  dismissed: [],
  thinCells: [{ cellKey: 'tr-a1-beri-dir:cloze', rows: 1 }],
  enumerationErrors: [],
};

describe('renderConstructionsMarkdown', () => {
  it('prints the sample denominator, never a bare count', () => {
    const md = renderConstructionsMarkdown(baseReport);
    expect(md).toContain('1/24');
    expect(md).toContain('sampled');
  });

  it('includes the prompt version and seed so a run is reproducible', () => {
    const md = renderConstructionsMarkdown(baseReport);
    expect(md).toContain('construction-coverage@2026-08-18');
    expect(md).toContain('default');
  });

  it('puts proposals in their own section', () => {
    const md = renderConstructionsMarkdown(baseReport);
    expect(md).toContain('## Proposed snippets');
  });

  it('lists skipped thin cells so a silent cap is impossible', () => {
    const md = renderConstructionsMarkdown(baseReport);
    expect(md).toContain('tr-a1-beri-dir:cloze');
  });

  it('marks a partial run prominently', () => {
    const md = renderConstructionsMarkdown({
      ...baseReport,
      partial: true,
      stoppedReason: 'cost cap of $2 reached',
    });
    expect(md).toContain('PARTIAL');
    expect(md).toContain('cost cap');
  });
});

describe('rankFindings', () => {
  it('puts zero-realized constructions before merely-rare ones', () => {
    const zero = {
      ...baseReport.findings[0],
      cellKey: 'a:cloze',
      missing: [{ id: 'x', label: 'x', mustRepresent: true, count: 0, share: 0 }],
    };
    const rare = {
      ...baseReport.findings[0],
      cellKey: 'b:cloze',
      missing: [{ id: 'y', label: 'y', mustRepresent: true, count: 1, share: 0.04 }],
    };
    expect(rankFindings([rare, zero]).map((f) => f.cellKey)).toEqual(['a:cloze', 'b:cloze']);
  });

  it('breaks ties by cell size, biggest first', () => {
    const small = { ...baseReport.findings[0], cellKey: 'a:cloze', sampled: 10,
      missing: [{ id: 'x', label: 'x', mustRepresent: true, count: 0, share: 0 }] };
    const big = { ...baseReport.findings[0], cellKey: 'b:cloze', sampled: 24,
      missing: [{ id: 'y', label: 'y', mustRepresent: true, count: 0, share: 0 }] };
    expect(rankFindings([small, big]).map((f) => f.cellKey)).toEqual(['b:cloze', 'a:cloze']);
  });
});

describe('estimateCallCostUsd', () => {
  it('prices at Sonnet rates', () => {
    expect(estimateCallCostUsd({ input_tokens: 1_000_000, output_tokens: 0 } as never)).toBeCloseTo(3);
    expect(estimateCallCostUsd({ input_tokens: 0, output_tokens: 1_000_000 } as never)).toBeCloseTo(15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test audit-constructions`
Expected: FAIL — `renderConstructionsMarkdown` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `packages/ai/scripts/audit-constructions.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';
import {
  ALL_CURRICULA,
  dismissedConstructionIds,
  findConstructionDismissal,
  requireEnv,
} from '@language-drill/db';
import type { GrammarPoint } from '@language-drill/shared';
import {
  CONSTRUCTION_COVERAGE_PROMPT_VERSION,
  DEFAULT_CLASSIFICATION_BATCH_SIZE,
  analyzeCell,
  classifyRowBatch,
  createClaudeClient,
  enumeratePointConstructions,
  pLimit,
  proposeMechanism,
  sampleRowsForCell,
  type CellAnalysis,
  type ClaimedConstruction,
  type ConstructionCount,
  type MechanismProposal,
  type PointEnumeration,
  type RowClassification,
} from '../src/index.js';

const SONNET_INPUT_USD_PER_MTOK = 3;
const SONNET_OUTPUT_USD_PER_MTOK = 15;

export function estimateCallCostUsd(usage: Anthropic.Usage): number {
  return (
    (usage.input_tokens / 1_000_000) * SONNET_INPUT_USD_PER_MTOK +
    (usage.output_tokens / 1_000_000) * SONNET_OUTPUT_USD_PER_MTOK
  );
}

export type ConstructionFinding = {
  cellKey: string;
  grammarPointKey: string;
  grammarPointName: string;
  type: string;
  language: string;
  cefrLevel: string;
  mechanism: PointEnumeration['mechanism'];
  sampled: number;
  classified: number;
  unresolved: number;
  missing: ConstructionCount[];
  counts: ConstructionCount[];
  proposal: MechanismProposal | null;
};

export type ConstructionAuditReport = {
  runName: string;
  promptVersion: string;
  seed: string;
  samplePerCell: number;
  /** True when a cost cap or an abort stopped the run before every point was
   *  examined. A truncated sweep that reads as complete turns a coverage gap
   *  invisible. */
  partial: boolean;
  stoppedReason: string | null;
  summary: {
    pointsEnumerated: number;
    pointsSingleConstruction: number;
    cellsClassified: number;
    rowsSampled: number;
    findings: number;
    enumerationSuspect: number;
    dismissed: number;
    thinCellsSkipped: number;
    enumerationErrors: number;
    costUsd: number;
  };
  findings: ConstructionFinding[];
  enumerationSuspect: Array<{ cellKey: string; unresolved: number; sampled: number }>;
  dismissed: Array<{ cellKey: string; constructionId: string; reason: string; dismissedOn: string }>;
  thinCells: Array<{ cellKey: string; rows: number }>;
  enumerationErrors: Array<{ grammarPointKey: string; message: string }>;
};

/** Zero-realized first, then bigger cells first. The retrofit tail per fix is
 *  real (merge → push-prompts → backfill:variant-seeds → demote:pool), so the
 *  top of this list is what actually gets worked. */
export function rankFindings(findings: readonly ConstructionFinding[]): ConstructionFinding[] {
  return [...findings].sort((a, b) => {
    const aZero = a.missing.some((m) => m.count === 0) ? 0 : 1;
    const bZero = b.missing.some((m) => m.count === 0) ? 0 : 1;
    if (aZero !== bZero) return aZero - bZero;
    if (a.sampled !== b.sampled) return b.sampled - a.sampled;
    return a.cellKey.localeCompare(b.cellKey);
  });
}

function pct(share: number): string {
  return `${(share * 100).toFixed(0)}%`;
}

export function renderConstructionsMarkdown(report: ConstructionAuditReport): string {
  const lines: string[] = [];
  lines.push(`# Construction-coverage audit — ${report.runName}`, '');
  if (report.partial) {
    lines.push(
      `> **PARTIAL RUN** — stopped early: ${report.stoppedReason ?? 'unknown'}. ` +
        'Points after the stop were never examined; absence of a finding below is NOT evidence of coverage.',
      '',
    );
  }
  lines.push(
    `Prompt version: \`${report.promptVersion}\` · seed: \`${report.seed}\` · sample cap: ${report.samplePerCell}`,
    '',
    '## Summary',
    '',
    `- Points enumerated: **${report.summary.pointsEnumerated}**`,
    `- Single-construction (classification skipped): **${report.summary.pointsSingleConstruction}**`,
    `- Cells classified: **${report.summary.cellsClassified}**`,
    `- Rows sampled: **${report.summary.rowsSampled}**`,
    `- Findings: **${report.summary.findings}**`,
    `- Enumeration-suspect cells: **${report.summary.enumerationSuspect}**`,
    `- Dismissed by ledger: **${report.summary.dismissed}**`,
    `- Thin cells skipped: **${report.summary.thinCellsSkipped}**`,
    `- Enumeration errors: **${report.summary.enumerationErrors}**`,
    `- Estimated cost: **$${report.summary.costUsd.toFixed(2)}**`,
    '',
    '## Findings',
    '',
  );

  if (report.findings.length === 0) {
    lines.push('_None._', '');
  }
  for (const f of rankFindings(report.findings)) {
    lines.push(
      `### \`${f.cellKey}\` — ${f.grammarPointName}`,
      '',
      `- Mechanism: **${f.mechanism}**`,
      `- Under-represented: ${f.missing
        .map((m) => `**${m.label}** (\`${m.id}\`) — realized ${m.count}/${f.sampled} sampled`)
        .join('; ')}`,
      `- Full distribution (of ${f.classified} classified, ${f.unresolved} unresolved):`,
      ...f.counts.map(
        (c) =>
          `  - \`${c.id}\` ${c.label}: ${c.count} (${pct(c.share)})` +
          `${c.mustRepresent ? '' : ' _[not load-bearing]_'}`,
      ),
      '',
    );
  }

  lines.push('## Proposed snippets', '');
  const withProposals = report.findings.filter((f) => f.proposal !== null);
  if (withProposals.length === 0) lines.push('_None._', '');
  for (const f of withProposals) {
    lines.push(
      `### \`${f.grammarPointKey}\` — ${f.proposal?.mechanism}`,
      '',
      f.proposal?.notes ?? '',
      '',
      '```ts',
      f.proposal?.snippet ?? '',
      '```',
      '',
    );
  }

  lines.push('## Enumeration-suspect cells', '');
  lines.push(
    '_The construction list is probably wrong for these; no finding was raised._',
    '',
  );
  if (report.enumerationSuspect.length === 0) lines.push('_None._', '');
  for (const s of report.enumerationSuspect) {
    lines.push(`- \`${s.cellKey}\`: ${s.unresolved}/${s.sampled} sampled rows unresolved`);
  }
  lines.push('');

  lines.push('## Dismissed by ledger', '');
  if (report.dismissed.length === 0) lines.push('_None._', '');
  for (const d of report.dismissed) {
    lines.push(`- \`${d.cellKey}\` / \`${d.constructionId}\` (${d.dismissedOn}): ${d.reason}`);
  }
  lines.push('');

  lines.push('## Skipped thin cells', '');
  if (report.thinCells.length === 0) lines.push('_None._', '');
  for (const t of report.thinCells) {
    lines.push(`- \`${t.cellKey}\`: ${t.rows} rows`);
  }
  lines.push('');

  if (report.enumerationErrors.length > 0) {
    lines.push('## Enumeration errors', '');
    for (const e of report.enumerationErrors) {
      lines.push(`- \`${e.grammarPointKey}\`: ${e.message}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** The grammar points this run covers, honouring the filters. */
export function selectPoints(filters: AuditConstructionsFilters): GrammarPoint[] {
  let points = ALL_CURRICULA.filter((p) => p.kind === 'grammar');
  if (filters.language) points = points.filter((p) => p.language === filters.language);
  if (filters.cefr) points = points.filter((p) => p.cefrLevel === filters.cefr);
  if (filters.grammarPoint) points = points.filter((p) => p.key === filters.grammarPoint);
  points = [...points].sort((a, b) => a.key.localeCompare(b.key));
  if (filters.maxPoints !== undefined) points = points.slice(0, filters.maxPoints);
  return points;
}
```

- [ ] **Step 4: Add the `main()` orchestration**

Append to `packages/ai/scripts/audit-constructions.ts`:

```ts
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main(): Promise<void> {
  const filters = parseAuditConstructionsArgs(process.argv.slice(2));

  if (filters.checkFixture) {
    await runCheckFixtureMode(filters);
    return;
  }

  const db = createDb(requireEnv('DATABASE_URL'));
  const rows = await loadApprovedRows(db, filters);
  const allCells = groupRowsIntoCells(rows);
  const points = selectPoints(filters);
  const pointKeys = new Set(points.map((p) => p.key));

  const cellsByPoint = new Map<string, Cell[]>();
  const thinCells: ConstructionAuditReport['thinCells'] = [];
  for (const cell of allCells) {
    if (!pointKeys.has(cell.grammarPointKey)) continue;
    if (cell.rows.length < filters.minRows) {
      thinCells.push({ cellKey: cell.cellKey, rows: cell.rows.length });
      continue;
    }
    const list = cellsByPoint.get(cell.grammarPointKey) ?? [];
    list.push(cell);
    cellsByPoint.set(cell.grammarPointKey, list);
  }

  const examinable = points.filter((p) => (cellsByPoint.get(p.key)?.length ?? 0) > 0);

  if (filters.dryRun) {
    const cellCount = [...cellsByPoint.values()].reduce((n, list) => n + list.length, 0);
    const sampled = [...cellsByPoint.values()]
      .flat()
      .reduce((n, c) => n + Math.min(c.rows.length, filters.samplePerCell), 0);
    console.log(
      `[audit-constructions] DRY RUN — no API calls, no cost.\n` +
        `  points to enumerate: ${examinable.length}\n` +
        `  cells in scope: ${cellCount}\n` +
        `  rows that would be sampled (upper bound): ${sampled}\n` +
        `  thin cells skipped (< ${filters.minRows} rows): ${thinCells.length}\n` +
        `  NOTE: classification runs only for points with >=2 must-represent\n` +
        `        constructions, so the real cost is well below this bound.`,
    );
    return;
  }

  const client = createClaudeClient(requireEnv('ANTHROPIC_API_KEY'));
  const limit = pLimit(filters.concurrency);
  let costUsd = 0;
  let partial = false;
  let stoppedReason: string | null = null;

  // The cost cap is checked BEFORE dispatching each unit of work. With
  // concurrency > 1 the in-flight jobs still complete, so the final cost can
  // modestly exceed the cap — the cap bounds new work, not work already sent.
  const budgetLeft = (): boolean => {
    if (costUsd < filters.maxCostUsd) return true;
    if (!partial) {
      partial = true;
      stoppedReason = `cost cap of $${filters.maxCostUsd} reached`;
    }
    return false;
  };

  const enumerations = new Map<string, PointEnumeration>();
  const enumerationErrors: ConstructionAuditReport['enumerationErrors'] = [];

  await Promise.all(
    examinable.map((gp) =>
      limit(async () => {
        if (!budgetLeft()) return;
        try {
          const { enumeration, usage } = await enumeratePointConstructions(
            client,
            gp,
            undefined,
            filters.enumerationModel,
          );
          costUsd += estimateCallCostUsd(usage);
          enumerations.set(gp.key, enumeration);
        } catch (err) {
          enumerationErrors.push({
            grammarPointKey: gp.key,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    ),
  );

  const findings: ConstructionFinding[] = [];
  const enumerationSuspect: ConstructionAuditReport['enumerationSuspect'] = [];
  const dismissedEntries: ConstructionAuditReport['dismissed'] = [];
  let cellsClassified = 0;
  let rowsSampled = 0;
  let singleConstruction = 0;

  for (const gp of examinable) {
    const enumeration = enumerations.get(gp.key);
    if (!enumeration) continue;
    const mustRepresent = enumeration.constructions.filter((c) => c.mustRepresent);
    if (mustRepresent.length < 2) {
      singleConstruction++;
      continue;
    }

    for (const cell of cellsByPoint.get(gp.key) ?? []) {
      if (!budgetLeft()) break;
      const sample = sampleRowsForCell(cell.rows, filters.seed, filters.samplePerCell);
      const batches = chunk(sample, DEFAULT_CLASSIFICATION_BATCH_SIZE);
      const results = await Promise.all(
        batches.map((batch) =>
          limit(async () => {
            const { classifications, usage } = await classifyRowBatch(client, {
              constructions: enumeration.constructions,
              type: cell.type,
              rows: batch,
            });
            costUsd += estimateCallCostUsd(usage);
            return classifications;
          }),
        ),
      );
      const classifications: RowClassification[] = results.flat();
      cellsClassified++;
      rowsSampled += sample.length;

      const dismissed = dismissedConstructionIds(cell.grammarPointKey, cell.type);
      for (const id of dismissed) {
        const entry = findConstructionDismissal(cell.grammarPointKey, cell.type, id);
        if (entry) {
          dismissedEntries.push({
            cellKey: cell.cellKey,
            constructionId: id,
            reason: entry.reason,
            dismissedOn: entry.dismissedOn,
          });
        }
      }

      const analysis: CellAnalysis = analyzeCell({
        constructions: enumeration.constructions,
        classifications,
        dismissedConstructionIds: dismissed,
      });

      if (analysis.status === 'enumeration-suspect') {
        enumerationSuspect.push({
          cellKey: cell.cellKey,
          unresolved: analysis.unresolved,
          sampled: analysis.sampled,
        });
        continue;
      }
      if (analysis.status !== 'finding') continue;

      let proposal: MechanismProposal | null = null;
      if (enumeration.mechanism !== 'none' && budgetLeft()) {
        try {
          const result = await proposeMechanism(client, {
            grammarPoint: gp,
            mechanism: enumeration.mechanism,
            counts: analysis.counts,
            sampled: analysis.sampled,
          });
          costUsd += estimateCallCostUsd(result.usage);
          proposal = result.proposal;
        } catch {
          proposal = null;
        }
      }

      findings.push({
        cellKey: cell.cellKey,
        grammarPointKey: cell.grammarPointKey,
        grammarPointName: gp.name,
        type: cell.type,
        language: gp.language,
        cefrLevel: gp.cefrLevel,
        mechanism: enumeration.mechanism,
        sampled: analysis.sampled,
        classified: analysis.classified,
        unresolved: analysis.unresolved,
        missing: analysis.missing,
        counts: analysis.counts,
        proposal,
      });
    }
  }

  const runName = filters.out ?? `constructions-${filters.seed}`;
  const report: ConstructionAuditReport = {
    runName,
    promptVersion: CONSTRUCTION_COVERAGE_PROMPT_VERSION,
    seed: filters.seed,
    samplePerCell: filters.samplePerCell,
    partial,
    stoppedReason,
    summary: {
      pointsEnumerated: enumerations.size,
      pointsSingleConstruction: singleConstruction,
      cellsClassified,
      rowsSampled,
      findings: findings.length,
      enumerationSuspect: enumerationSuspect.length,
      dismissed: dismissedEntries.length,
      thinCellsSkipped: thinCells.length,
      enumerationErrors: enumerationErrors.length,
      costUsd,
    },
    findings: rankFindings(findings),
    enumerationSuspect,
    dismissed: dismissedEntries,
    thinCells,
    enumerationErrors,
  };

  const outDir = path.join(process.cwd(), 'audit-runs');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, `${runName}.json`), JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(path.join(outDir, `${runName}.md`), renderConstructionsMarkdown(report), 'utf8');
  console.log(
    `[audit-constructions] ${findings.length} findings · $${costUsd.toFixed(2)} · audit-runs/${runName}.md`,
  );
}

// Only run main() when executed directly, so the test file can import the
// pure helpers without triggering a DB connection.
if (process.argv[1]?.endsWith('audit-constructions.ts')) {
  void main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
```

> **Implementer note:** `runCheckFixtureMode` is defined in Task 8. Until then, stub it as `async function runCheckFixtureMode(_f: AuditConstructionsFilters): Promise<void> { throw new Error('not implemented'); }` and replace it in Task 8.
>
> **On "append" throughout Tasks 3–8:** every `import` shown in an appended block belongs in the file's existing top-of-file import section, merged into the matching statement — ESLint's `import/first` rejects imports below other statements. Only the non-import code is literally appended.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test audit-constructions && pnpm --filter @language-drill/ai typecheck`
Expected: PASS (all Task 6 tests plus 8 new), typecheck clean

- [ ] **Step 6: Commit**

```bash
git add packages/ai/scripts/audit-constructions.ts packages/ai/scripts/audit-constructions.test.ts
git commit -m "Wire the construction-coverage audit stages, cost cap, and report"
```

---

### Task 8: Fixture and `--check-fixture` mode

**Files:**
- Create: `packages/ai/scripts/fixtures/construction-coverage-cases.json`
- Modify: `packages/ai/scripts/audit-constructions.ts` (replace the stub)
- Modify: `packages/ai/scripts/audit-constructions.test.ts` (append)

**Interfaces:**
- Consumes: `enumeratePointConstructions`, `CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT`
- Produces: `FixtureCase`, `loadFixtureCases(path)`, `scoreFixtureCase(draws, expected)`, `runCheckFixtureMode(filters)`, `FIXTURE_DRAWS_PER_CASE`

**Blocking input required:** the fixture's negative cases must be hand-labelled by the repo owner. Picking them from the same reasoning the judge uses would validate nothing. Do not invent them — ask, and leave the file with only the positive case until they are supplied.

- [ ] **Step 1: Write the failing test**

Append to `packages/ai/scripts/audit-constructions.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT } from '../src/index.js';
import { loadFixtureCases, scoreFixtureCase, FIXTURE_DRAWS_PER_CASE } from './audit-constructions.js';

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'construction-coverage-cases.json');

describe('fixture', () => {
  it('parses', () => {
    expect(loadFixtureCases(FIXTURE_PATH).length).toBeGreaterThan(0);
  });

  // Memory: never build a judge's fixture from its own few-shot examples — the
  // check would measure memorisation, not judgment. Enforced mechanically so a
  // later prompt edit that adds an example breaks the build.
  it('shares no point key with the enumeration prompt examples', () => {
    for (const c of loadFixtureCases(FIXTURE_PATH)) {
      expect(CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT).not.toContain(c.grammarPointKey);
    }
  });

  it('gives every case an expected must-represent count', () => {
    for (const c of loadFixtureCases(FIXTURE_PATH)) {
      expect(Number.isInteger(c.expectedMustRepresentCount)).toBe(true);
    }
  });
});

describe('scoreFixtureCase', () => {
  it('takes the majority across draws', () => {
    expect(scoreFixtureCase([2, 2, 3], 2)).toEqual({ majority: 2, passed: true });
    expect(scoreFixtureCase([1, 1, 3], 2)).toEqual({ majority: 1, passed: false });
  });

  it('uses three draws', () => {
    expect(FIXTURE_DRAWS_PER_CASE).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test audit-constructions`
Expected: FAIL — fixture file and `loadFixtureCases` do not exist

- [ ] **Step 3: Create the fixture**

Create `packages/ai/scripts/fixtures/construction-coverage-cases.json`. The positive case embeds a **recorded snapshot**: `es-b1-reported-speech`'s pre-#664 description (no `constructionVariants`) and sampled rows. A live query would not reproduce it — #664 added the variants and #665's retrofit demoted rows, so the approved pool now reflects the fix, and a live fixture would silently start passing for the wrong reason.

```json
{
  "cases": [
    {
      "name": "es-b1-reported-speech-pre-664",
      "grammarPointKey": "es-b1-reported-speech-snapshot",
      "note": "Recorded pre-#664 state, verbatim from `git show 2c76509a^:packages/db/src/curriculum/es.ts`. The key is deliberately suffixed so it never resolves against the live curriculum, and so the contamination test compares against a key the prompt cannot contain.",
      "grammarPoint": {
        "key": "es-b1-reported-speech-snapshot",
        "kind": "grammar",
        "name": "Reported speech (present-to-past)",
        "description": "Indirect statements shifting present to imperfect under a past-tense reporting verb (Dijo que tenía sueño; Pensé que estabas cansado), and reported commands with que + present subjunctive (Dice que te sientes).",
        "cefrLevel": "B1",
        "language": "ES",
        "examplesPositive": [
          "Dijo que tenía mucho sueño.",
          "El profesor dice que hagamos los deberes."
        ],
        "examplesNegative": ["*Dijo que tiene mucho sueño."],
        "commonErrors": [
          "Keeping the present tense in the reported clause after a past-tense reporting verb (\"*dijo que tiene sueño\" instead of \"dijo que tenía sueño\").",
          "Reporting a command with the infinitive instead of que + present subjunctive (\"*dice hacer los deberes\" instead of \"dice que hagamos los deberes\").",
          "Using the indicative for a reported command instead of switching to the subjunctive (\"*dice que vienes\" instead of \"dice que vengas\" when relaying an order)."
        ]
      },
      "expectedMustRepresentCount": 2,
      "expectedMechanism": "construction-variants"
    }
  ]
}
```

This is the exact text the generator produced 96/99 backshift rows against — the
positive case must be the wording that actually failed, not a paraphrase of it.

- [ ] **Step 4: Implement the fixture mode**

Replace the `runCheckFixtureMode` stub in `packages/ai/scripts/audit-constructions.ts`:

```ts
export const FIXTURE_DRAWS_PER_CASE = 3;

export type FixtureCase = {
  name: string;
  grammarPointKey: string;
  grammarPoint: GrammarPoint;
  expectedMustRepresentCount: number;
  expectedMechanism: PointEnumeration['mechanism'];
};

export function loadFixtureCases(fixturePath: string): FixtureCase[] {
  const parsed: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { cases?: unknown }).cases)
  ) {
    throw new Error(`fixture ${fixturePath} must be an object with a 'cases' array`);
  }
  return (parsed as { cases: FixtureCase[] }).cases;
}

/** Majority vote across draws. A tie counts as a failure — an unstable judge
 *  is not a passing judge. */
export function scoreFixtureCase(
  draws: readonly number[],
  expected: number,
): { majority: number; passed: boolean } {
  const tally = new Map<number, number>();
  for (const d of draws) tally.set(d, (tally.get(d) ?? 0) + 1);
  let majority = draws[0];
  let best = 0;
  let tied = false;
  for (const [value, n] of tally) {
    if (n > best) {
      best = n;
      majority = value;
      tied = false;
    } else if (n === best) {
      tied = true;
    }
  }
  return { majority, passed: !tied && majority === expected };
}

// `--out` names the REPORT, not the fixture, so it is deliberately not consulted
// here — overloading it would make `--check-fixture --out x` silently look for a
// fixture at the report path.
const DEFAULT_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'construction-coverage-cases.json');

async function runCheckFixtureMode(filters: AuditConstructionsFilters): Promise<void> {
  const cases = loadFixtureCases(DEFAULT_FIXTURE_PATH);
  const client = createClaudeClient(requireEnv('ANTHROPIC_API_KEY'));

  let passed = 0;
  for (const c of cases) {
    const draws: number[] = [];
    for (let i = 0; i < FIXTURE_DRAWS_PER_CASE; i++) {
      const { enumeration } = await enumeratePointConstructions(
        client,
        c.grammarPoint,
        undefined,
        filters.enumerationModel,
      );
      draws.push(enumeration.constructions.filter((x) => x.mustRepresent).length);
    }
    const score = scoreFixtureCase(draws, c.expectedMustRepresentCount);
    if (score.passed) passed++;
    console.log(
      `${score.passed ? 'PASS' : 'FAIL'}  ${c.name}  draws=[${draws.join(', ')}]  ` +
        `majority=${score.majority}  expected=${c.expectedMustRepresentCount}`,
    );
  }
  console.log(`\n[audit-constructions] fixture: ${passed}/${cases.length} passed`);
  if (passed < cases.length) process.exitCode = 1;
}
```

Add `readFileSync` to the `node:fs` import at the top of the file.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test audit-constructions`
Expected: PASS (all prior tests plus 5 new)

- [ ] **Step 6: Commit**

```bash
git add packages/ai/scripts/audit-constructions.ts packages/ai/scripts/audit-constructions.test.ts \
        packages/ai/scripts/fixtures/construction-coverage-cases.json
git commit -m "Add the construction-coverage fixture check with contamination guard"
```

---

### Task 9: Documentation and full gate

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/curriculum-authoring.md`

- [ ] **Step 1: Add the CLAUDE.md command-table row**

In the command table, after the `pnpm audit:gloss` row, add:

```markdown
| `pnpm audit:constructions` | **Read-only, never writes to the pool.** Sweeps the approved cloze/translation pool for points whose description claims several constructions but whose pool realizes one — the PR #664 defect class, invisible to `audit:collapse` (two of its three signals read declared mechanisms a spec-less point lacks by definition; the other two are lexical, so 45 rows of one construction over 45 different nouns look diverse). Four stages: enumerate the constructions a point claims and label each must-represent vs. illustrative; classify a deterministic, seeded per-cell sample against them; flag any must-represent construction at 0 or ≤5% of classified rows; and, for confirmed findings, print a paste-ready `constructionVariants` / `coverageSpec` snippet for human review. A cell whose sampled rows are >33% unresolved reports as `enumeration-suspect` and raises **no** finding — a high unresolved rate means the construction list was wrong, not that the pool collapsed. **`--dry-run` makes no API calls and costs nothing** (unlike `revalidate:cloze` / `backfill:coverage-tags`, where a dry-run costs the same as an apply). Writes JSON + markdown to `./audit-runs/`. Supports `--language`, `--cefr`, `--grammar-point`, `--type`, `--max-points` (**not** `--limit`), `--min-rows`, `--sample-per-cell`, `--seed`, `--max-cost-usd`, `--concurrency`, `--enumeration-model`, `--check-fixture`. A spotlight, not a gate. |
```

- [ ] **Step 2: Cross-reference from the authoring checklist**

In `docs/curriculum-authoring.md`, in the section covering the coverageSpec decision, add:

```markdown
> **Detecting the failure after the fact.** `pnpm audit:constructions` sweeps the
> approved pool for points whose description claims several constructions but
> whose rows realize one, and recommends which mechanism fixes each — a
> `coverageSpec` axis when the items are values of one dimension (person,
> number, plural class), or `constructionVariants` when they are distinct
> sub-constructions. It is a spotlight, not a gate: authoring the decision up
> front is still the cheap path, since a retrofit onto a filled cell needs a
> merge, a Langfuse push, `backfill:variant-seeds`, and `demote:pool` for
> headroom before a single new draft is generated.
```

- [ ] **Step 3: Run the full gate, package by package**

```bash
pnpm --filter @language-drill/shared test
pnpm --filter @language-drill/db test
pnpm --filter @language-drill/ai test
pnpm lint
pnpm typecheck
```

Expected: zero failures. A root `pnpm test` gets killed partway through on this machine — run per package.

- [ ] **Step 4: Smoke-test the CLI against one point**

```bash
pnpm audit:constructions --grammar-point es-b1-reported-speech --dry-run
```

Expected: prints the dry-run estimate, makes no API calls, writes nothing.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/curriculum-authoring.md
git commit -m "Document audit:constructions"
```

---

## Post-implementation, before the first full sweep

These are **not** implementation tasks — they gate the sweep, and each needs the repo owner.

1. **Hand-label the fixture negatives** (blocks Task 8 completeness). Without negatives the check tests recall but not precision, and precision is the failure mode that made `audit:collapse` unusable — 151 flagged, 0 confirmed.
2. **Run `--check-fixture` on both `claude-sonnet-4-6` and Opus** via `--enumeration-model`, and pick stage 1's model from the result rather than from a guess.
3. **Pilot on one language** (`--language ES --max-points 20`) and read every finding before sweeping all 312.
