# Scheduled Mastery Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mastery rebuild reproduce exactly what the live submit path writes, then run it nightly so stored mastery self-heals within 24h of any evidence-revoking demotion.

**Architecture:** `error_observations` is folded into the replay alongside `user_exercise_history`, giving a faithful — and therefore idempotent — rebuild. The rebuild core moves out of the CLI script into `packages/db/src/mastery/rebuild.ts` so a scheduled Lambda and the CLI share one implementation. The Lambda runs at 03:00 UTC behind a delete-count circuit breaker that aborts the whole run rather than applying partially.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres/Neon), AWS CDK, EventBridge + Lambda, Vitest.

## Global Constraints

- **Worktree:** all work happens in `/Users/seal/dev/language-drill/.claude/worktrees/scheduled-mastery-rebuild` on branch `feat/scheduled-mastery-rebuild`. Use absolute paths rooted there — main-repo absolute paths silently write to the main checkout.
- **Design source of truth:** `docs/superpowers/specs/2026-08-09-scheduled-mastery-rebuild-design.md`.
- **`packages/db` must NOT import from `infra/lambda`** — lambda depends on db, so the reverse is a build cycle. Shared code moves *into* `packages/db` and is re-exported.
- **Cross-package consumers import from the `@language-drill/db` barrel**, never deep relative paths. Code inside `packages/db` may use relative paths.
- **`packages/db` is consumed from `dist/`** — run `pnpm build` after editing `packages/db/src` and before running a test that imports it.
- **Never run `pnpm build` immediately before `pnpm test`.** The build compiles all 87 lambda test files into `infra/lambda/dist`, where vitest re-collects them; the run then reports ~174 files instead of 87 and fails phantom tests. If you see a doubled file count, `rm -rf infra/lambda/dist` and re-run.
- **Lambda test files must `vi.mock('../db')`** or they pass locally and break in CI where `DATABASE_URL` is unset.
- **Severity → score mapping is exactly `{ major: 0, minor: 0.4 }`** — the existing `SEVERITY_SCORE` constant. Do not re-derive it.
- **Schedule is 03:00 UTC daily.** Breaker default is **5** deletions, env var `MASTERY_REBUILD_MAX_DELETES`.
- **Pre-push gate, from the worktree root, zero failures:** `pnpm lint && pnpm typecheck && pnpm test`.
- **Touch no database.** Every task here is code only; the prod run is Task 8, human-gated.

---

## File Structure

**Create**
- `packages/db/src/mastery/incidental-fold.ts` — moved from `infra/lambda/src/lib/mastery/`; owns `SEVERITY_SCORE` and `incidentalObservations`, so both the live path and the replay share one definition.
- `packages/db/src/mastery/incidental-fold.test.ts` — moved with it.
- `packages/db/src/mastery/rebuild.ts` — the rebuild core: loads both observation sources, merges, replays, computes upserts/deletes/diff, applies. Pure orchestration over an injected `Db`; prints nothing.
- `packages/db/src/mastery/rebuild.test.ts` — moved from `packages/db/scripts/backfill-mastery.test.ts`.
- `infra/lambda/src/mastery/rebuild-handler.ts` — thin Lambda entry point.
- `infra/lambda/src/mastery/rebuild-handler.test.ts`
- `infra/lib/constructs/mastery-rebuild-lambda.ts` — NodejsFunction + gated EventBridge rule.
- `infra/lib/constructs/mastery-rebuild-lambda.test.ts` — CDK synth assertions.

**Modify**
- `packages/db/src/mastery/update.ts` — `HistoryRow` gains `sourceRank`; `replayHistory` sorts on it.
- `packages/db/src/mastery/update.test.ts` — ordering cases.
- `packages/db/src/index.ts` — export the new modules.
- `packages/db/scripts/backfill-mastery.ts` — reduced to a CLI wrapper.
- `infra/lambda/src/lib/mastery/incidental-fold.ts` — deleted; its importer updated to the barrel.
- `infra/lambda/src/routes/exercises.ts` — import `incidentalObservations` from `@language-drill/db`.
- `infra/lib/stack.ts`, `infra/bin/app.ts` — wire the construct.
- `CLAUDE.md`, `docs/runbooks/prompt-update-and-revalidate.md` — document the schedule.

---

### Task 1: Move the incidental fold into `packages/db`

`SEVERITY_SCORE` currently lives in `infra/lambda`, which `packages/db` cannot import. The replay needs it, so the definition moves down and the lambda imports it back through the barrel. Pure move — no behaviour change.

**Files:**
- Create: `packages/db/src/mastery/incidental-fold.ts`, `packages/db/src/mastery/incidental-fold.test.ts`
- Delete: `infra/lambda/src/lib/mastery/incidental-fold.ts`, `infra/lambda/src/lib/mastery/incidental-fold.test.ts`
- Modify: `packages/db/src/index.ts`, `infra/lambda/src/routes/exercises.ts`

**Interfaces:**
- Produces: from `@language-drill/db` — `SEVERITY_SCORE: Record<'major'|'minor', number>` (`{ major: 0, minor: 0.4 }`), `incidentalObservations(errors, hostGrammarPointKey, at): IncidentalObs[]`, `type IncidentalObs = { grammarPointKey: string; score: number; at: Date }`.

- [ ] **Step 1: Move both files verbatim**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/scheduled-mastery-rebuild
git mv infra/lambda/src/lib/mastery/incidental-fold.ts packages/db/src/mastery/incidental-fold.ts
git mv infra/lambda/src/lib/mastery/incidental-fold.test.ts packages/db/src/mastery/incidental-fold.test.ts
```

Then in the moved source, export the severity map (it is currently module-private):

```ts
export const SEVERITY_SCORE: Record<EvaluationError['severity'], number> = {
  major: 0,
  minor: 0.4,
};
```

Fix the test's import path to `'./incidental-fold'`. Change nothing else.

- [ ] **Step 2: Export from the barrel**

In `packages/db/src/index.ts`, below the existing mastery exports (`export { updateMastery, replayHistory } from './mastery/update';`):

```ts
// Incidental error→mastery fold. Lives here rather than in infra/lambda so the
// replay in ./mastery/rebuild can reuse the same SEVERITY_SCORE the live submit
// path folds with — two copies would drift and make rebuilds unfaithful.
export { SEVERITY_SCORE, incidentalObservations } from './mastery/incidental-fold';
export type { IncidentalObs } from './mastery/incidental-fold';
```

- [ ] **Step 3: Update the consumer**

In `infra/lambda/src/routes/exercises.ts`, delete the line
`import { incidentalObservations } from '../lib/mastery/incidental-fold';`
and add `incidentalObservations` to the existing `@language-drill/db` import list.

- [ ] **Step 4: Verify nothing else referenced the old path**

Run: `rg -n "lib/mastery/incidental-fold" infra apps packages`
Expected: no output.

- [ ] **Step 5: Build and test**

Run: `pnpm build && pnpm --filter @language-drill/db exec vitest run src/mastery/ && rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda exec vitest run src/routes/exercises.test.ts`
Expected: PASS, with the moved incidental-fold tests running under `@language-drill/db`.

- [ ] **Step 6: Commit**

```bash
git add -A packages/db/src/mastery packages/db/src/index.ts infra/lambda/src
git commit -m "refactor(db): move the incidental mastery fold into packages/db"
```

---

### Task 2: Deterministic ordering for merged observations

The replay will interleave host and incidental observations. `updateMastery` is sequential and recency-decayed, so the fold order changes the result. At submit the host score is applied first and the incidental fold follows, so **host must sort before incidental at an equal timestamp**.

**Files:**
- Modify: `packages/db/src/mastery/update.ts:23-29` (`HistoryRow`), `:90-110` (`replayHistory`)
- Modify: `packages/db/src/mastery/update.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `HistoryRow` gains `sourceRank?: 0 | 1` — `0` host (default when absent), `1` incidental. `replayHistory` sorts by `(evaluatedAt, sourceRank)`.

- [ ] **Step 1: Write the failing test**

Append to `packages/db/src/mastery/update.test.ts`:

```ts
describe('replayHistory ordering', () => {
  const at = d('2026-01-01');

  it('folds a host observation before an incidental one at the same instant', () => {
    // Same timestamp, opposite order in the input array. The live path applies
    // the host score first, so both orderings must fold to the host-then-
    // incidental result — otherwise a rebuild silently disagrees with the
    // value the submit path wrote.
    const host = { grammarPointKey: 'p', score: 1, difficulty: CefrLevel.A1, evaluatedAt: at, sourceRank: 0 as const };
    const incidental = { grammarPointKey: 'p', score: 0, difficulty: CefrLevel.A1, evaluatedAt: at, sourceRank: 1 as const };

    const a = replayHistory([host, incidental]).get('p')!;
    const b = replayHistory([incidental, host]).get('p')!;

    expect(a.masteryScore).toBeCloseTo(b.masteryScore, 10);
    expect(a.evidenceCount).toBe(2);
  });

  it('treats a row with no sourceRank as host', () => {
    const legacy = { grammarPointKey: 'p', score: 1, difficulty: CefrLevel.A1, evaluatedAt: at };
    const incidental = { grammarPointKey: 'p', score: 0, difficulty: CefrLevel.A1, evaluatedAt: at, sourceRank: 1 as const };

    const withDefault = replayHistory([incidental, legacy]).get('p')!;
    const explicit = replayHistory([
      { ...legacy, sourceRank: 0 as const },
      incidental,
    ]).get('p')!;

    expect(withDefault.masteryScore).toBeCloseTo(explicit.masteryScore, 10);
  });

  it('still orders primarily by timestamp', () => {
    const early = { grammarPointKey: 'p', score: 0, difficulty: CefrLevel.A1, evaluatedAt: d('2026-01-01'), sourceRank: 1 as const };
    const late = { grammarPointKey: 'p', score: 1, difficulty: CefrLevel.A1, evaluatedAt: d('2026-02-01'), sourceRank: 0 as const };
    const state = replayHistory([late, early]).get('p')!;
    expect(state.lastPracticedAt).toEqual(d('2026-02-01'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/db exec vitest run src/mastery/update.test.ts`
Expected: FAIL — `sourceRank` is not a known property of `HistoryRow` (type error), and the equal-timestamp orderings differ.

- [ ] **Step 3: Implement**

In `packages/db/src/mastery/update.ts`, add to `HistoryRow`:

```ts
  /**
   * Which writer produced this observation: 0 = host (the exercise's own
   * grammar point), 1 = incidental (an evaluator error attributed to another
   * point). Absent means host. Used only as a tie-break so a merged replay
   * folds in the same order the live submit path did — host score first, then
   * the incidental fold.
   */
  sourceRank?: 0 | 1;
```

and change `replayHistory`'s sort:

```ts
  const sorted = [...rows].sort(
    (a, b) =>
      a.evaluatedAt.getTime() - b.evaluatedAt.getTime() ||
      (a.sourceRank ?? 0) - (b.sourceRank ?? 0),
  );
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @language-drill/db exec vitest run src/mastery/update.test.ts`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/mastery/update.ts packages/db/src/mastery/update.test.ts
git commit -m "feat(db): order merged mastery observations host-before-incidental"
```

---

### Task 3: Extract the rebuild core out of the CLI

`run()` and its helpers live in `packages/db/scripts/backfill-mastery.ts`, which a Lambda cannot import. Move them into the package source. **This task is a move with no behaviour change** — the existing tests are the proof.

**Files:**
- Create: `packages/db/src/mastery/rebuild.ts`, `packages/db/src/mastery/rebuild.test.ts`
- Modify: `packages/db/scripts/backfill-mastery.ts`, `packages/db/src/index.ts`
- Delete: `packages/db/scripts/backfill-mastery.test.ts` (moved)

**Interfaces:**
- Consumes: `replayHistory` with `sourceRank` (Task 2).
- Produces, all exported from `@language-drill/db`: `run(db: Db, opts: RunOptions): Promise<RunResult>`, `formatDiffReport(input: DiffReportInput): string`, `summarize(params): string`, plus the types `RunOptions`, `RunResult`, `DiffReportInput`, `MasteryShift`, `StaleMasteryRow`, `ExistingMasteryRow`, `GroupKey`, `PointKey`, and the helpers `findStaleMasteryRows`, `planStaleMasteryDeletions`, `pointKey`.

- [ ] **Step 1: Move the module**

```bash
git mv packages/db/scripts/backfill-mastery.test.ts packages/db/src/mastery/rebuild.test.ts
```

Create `packages/db/src/mastery/rebuild.ts` containing **everything from `packages/db/scripts/backfill-mastery.ts` except** `arg()`, `main()`, and the `invokedDirectly` block — i.e. lines 19 through 555 in the current file: `isCefr`, `isNonEvidenceReason`, all exported types, `pointKey`, `findStaleMasteryRows`, `planStaleMasteryDeletions`, `summarize`, `formatDiffReport`, `pushToGroup`, and `run`.

Rewrite the imports for the new location — `../schema`, `./update`, `../client`, `../lib/evidence` become relative to `packages/db/src/mastery/`. Keep every doc comment verbatim; they encode hard-won safety reasoning (the snapshot-first ordering, the two-replay diff, the delete guards).

Fix the test file's import to `'./rebuild'`.

- [ ] **Step 2: Reduce the script to a wrapper**

`packages/db/scripts/backfill-mastery.ts` keeps only its header comment, `arg()`, `main()`, and the `invokedDirectly` guard, importing what it needs:

```ts
import { createDb } from '../src/client';
import { run, summarize, formatDiffReport } from '../src/mastery/rebuild';
```

Its `main()` body is unchanged.

- [ ] **Step 3: Export from the barrel**

In `packages/db/src/index.ts`, below the incidental-fold exports from Task 1:

```ts
// Mastery rebuild core. Shared by the `backfill:mastery` CLI and the nightly
// rebuild Lambda so both apply identical logic — see
// docs/superpowers/specs/2026-08-09-scheduled-mastery-rebuild-design.md.
export * from './mastery/rebuild';
```

- [ ] **Step 4: Verify the move changed no behaviour**

Run: `pnpm build && pnpm --filter @language-drill/db exec vitest run src/mastery/rebuild.test.ts`
Expected: PASS with the same test count as before the move (18 at time of writing).

If any test fails, the move was not faithful — diff the moved code against `git show HEAD:packages/db/scripts/backfill-mastery.ts` rather than editing the test.

- [ ] **Step 5: Verify the CLI still works end-to-end**

Run: `pnpm --filter @language-drill/db backfill:mastery 2>&1 | head -5`
Expected: a dry-run summary line against the dev database (the worktree `.env`), not a stack trace. Do **not** pass `--apply`.

- [ ] **Step 6: Commit**

```bash
git add -A packages/db
git commit -m "refactor(db): extract the mastery rebuild core out of the CLI script"
```

---

### Task 4: Fold incidental observations into the replay

The fidelity fix. Without it, a rebuild discards every incidental contribution on a point that also has host history.

**Files:**
- Modify: `packages/db/src/mastery/rebuild.ts` (the `run` function's load + grouping section)
- Modify: `packages/db/src/mastery/rebuild.test.ts`

**Interfaces:**
- Consumes: `SEVERITY_SCORE` (Task 1), `sourceRank` (Task 2).
- Produces: no signature change to `run`. `RunResult.historyRowCount` now counts merged observations, host and incidental.

- [ ] **Step 1: Write the failing tests**

Add to `packages/db/src/mastery/rebuild.test.ts`, following the file's existing fake-`Db` pattern (copy the mock shape from the neighbouring tests — the fake must now answer a third `select().from(errorObservations)` call):

```ts
describe('incidental observations in the replay', () => {
  it('folds an incidental observation for a point with no host history', async () => {
    // The point exists only because an evaluator error was attributed to it.
    // Before this change the replay never saw it and the row looked stale.
    const result = await run(fakeDb({
      history: [],
      observations: [
        { userId: 'u1', language: 'TR', hostGrammarPointKey: 'host', errorGrammarPointKey: 'p',
          severity: 'major', occurredAt: new Date('2026-01-01'), exerciseHistoryId: 'h1',
          difficulty: 'A1', demotionReason: null },
      ],
      existing: [],
    }), { apply: false, includeDemoted: false });

    const shift = result.diff.shifts.find((s) => s.grammarPointKey === 'p');
    expect(shift).toBeDefined();
    expect(result.deletes).toBe(0);
  });

  it('collapses multiple errors on one point within a submission to the worst score', async () => {
    // incidentalObservations() takes the worst severity per (submission, point).
    // Folding three observations instead of one would triple-count the penalty.
    const obs = (severity: 'major' | 'minor') => ({
      userId: 'u1', language: 'TR', hostGrammarPointKey: 'host', errorGrammarPointKey: 'p',
      severity, occurredAt: new Date('2026-01-01'), exerciseHistoryId: 'h1',
      difficulty: 'A1', demotionReason: null,
    });
    const result = await run(fakeDb({
      history: [], observations: [obs('minor'), obs('major'), obs('minor')], existing: [],
    }), { apply: false, includeDemoted: false });

    expect(result.historyRowCount).toBe(1);
  });

  it('ignores an error attributed to the host point itself', async () => {
    // Already reflected in the submission score; folding it again double-penalizes.
    const result = await run(fakeDb({
      history: [],
      observations: [
        { userId: 'u1', language: 'TR', hostGrammarPointKey: 'p', errorGrammarPointKey: 'p',
          severity: 'major', occurredAt: new Date('2026-01-01'), exerciseHistoryId: 'h1',
          difficulty: 'A1', demotionReason: null },
      ],
      existing: [],
    }), { apply: false, includeDemoted: false });

    expect(result.historyRowCount).toBe(0);
  });

  it('excludes an observation recorded against a defect-demoted exercise', async () => {
    const result = await run(fakeDb({
      history: [],
      observations: [
        { userId: 'u1', language: 'TR', hostGrammarPointKey: 'host', errorGrammarPointKey: 'p',
          severity: 'major', occurredAt: new Date('2026-01-01'), exerciseHistoryId: 'h1',
          difficulty: 'A1', demotionReason: 'quality' },
      ],
      existing: [],
    }), { apply: false, includeDemoted: false });

    expect(result.historyRowCount).toBe(0);
  });

  it('ignores an observation with no attributed grammar point', async () => {
    const result = await run(fakeDb({
      history: [],
      observations: [
        { userId: 'u1', language: 'TR', hostGrammarPointKey: 'host', errorGrammarPointKey: null,
          severity: 'major', occurredAt: new Date('2026-01-01'), exerciseHistoryId: 'h1',
          difficulty: 'A1', demotionReason: null },
      ],
      existing: [],
    }), { apply: false, includeDemoted: false });

    expect(result.historyRowCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @language-drill/db exec vitest run src/mastery/rebuild.test.ts`
Expected: FAIL — the fake `Db` has no observations source and `run` never queries one.

- [ ] **Step 3: Load the observations**

In `run()`, immediately after the existing history query, add a second query. `error_observations.language` is denormalized and uppercase, so it needs no join for scoping; the join to `exercises` supplies difficulty and the demotion reason.

```ts
  // --- Incidental observations --------------------------------------------
  // The live submit path folds evaluator errors attributed to points OTHER
  // than the exercise's own into mastery (see incidentalObservations). Those
  // produce NO user_exercise_history row, so a history-only replay silently
  // discards them. error_observations persists the same errors, so the replay
  // reconstructs them here. Demotion reason travels as data, exactly as the
  // history query does, so both replays can be diffed.
  const obsWhere = [
    isNotNull(errorObservations.errorGrammarPointKey),
    ne(errorObservations.errorGrammarPointKey, errorObservations.hostGrammarPointKey),
  ];
  if (userFilter) obsWhere.push(eq(errorObservations.userId, userFilter));
  if (languageFilter) obsWhere.push(eq(errorObservations.language, languageFilter));

  const observationRows = await db
    .select({
      userId: errorObservations.userId,
      language: errorObservations.language,
      grammarPointKey: errorObservations.errorGrammarPointKey,
      severity: errorObservations.severity,
      occurredAt: errorObservations.occurredAt,
      exerciseHistoryId: errorObservations.exerciseHistoryId,
      difficulty: exercises.difficulty,
      demotionReason: exercises.demotionReason,
    })
    .from(errorObservations)
    .innerJoin(exercises, eq(errorObservations.exerciseId, exercises.id))
    .where(and(...obsWhere))
    .orderBy(asc(errorObservations.occurredAt));
```

Add `ne` to the `drizzle-orm` import and `errorObservations` to the schema import.

Note on the `ne(...)` predicate: `host_grammar_point_key` is nullable, and SQL `<>` yields NULL — not true — when either side is NULL, so a row whose host point is NULL is excluded by this predicate. That matches the live fold, which returns `[]` when `hostGrammarPointKey === null`.

- [ ] **Step 4: Dedup and merge**

After the existing history grouping loop, before the two `replayHistory` calls:

```ts
  // Collapse to one observation per (submission, point), worst score wins —
  // mirroring incidentalObservations(), which folds a submission's errors on
  // the same point into a single worst-severity observation. Without this a
  // submission flagging three errors on one point would fold three penalties.
  const worstPerSubmission = new Map<string, {
    userId: string; language: string; grammarPointKey: string;
    score: number; difficulty: CefrLevel; occurredAt: Date; demotionReason: string | null;
  }>();
  for (const r of observationRows) {
    if (!r.userId || !r.language || !r.grammarPointKey) continue;
    if (!isCefr(r.difficulty)) continue;
    const severity = r.severity as 'major' | 'minor';
    const score = SEVERITY_SCORE[severity];
    if (score === undefined) continue;
    const key = `${r.exerciseHistoryId} ${r.grammarPointKey}`;
    const prev = worstPerSubmission.get(key);
    if (prev === undefined || score < prev.score) {
      worstPerSubmission.set(key, {
        userId: r.userId, language: r.language, grammarPointKey: r.grammarPointKey,
        score, difficulty: r.difficulty, occurredAt: new Date(r.occurredAt as Date),
        demotionReason: r.demotionReason,
      });
    }
  }

  for (const o of worstPerSubmission.values()) {
    const k: GroupKey = `${o.userId} ${o.language}`;
    langOf.set(k, o.language);
    const entry: HistoryRow = {
      grammarPointKey: o.grammarPointKey,
      score: o.score,
      difficulty: o.difficulty,
      evaluatedAt: o.occurredAt,
      sourceRank: 1,
    };
    pushToGroup(unfilteredByGroup, k, entry);
    if (!isNonEvidenceReason(o.demotionReason)) pushToGroup(survivingByGroup, k, entry);
  }
```

Import `SEVERITY_SCORE` from `./incidental-fold` and `CefrLevel` if not already imported.

`replayHistory` sorts internally, so the merged lists need no pre-sort — Task 2's comparator puts host before incidental at equal timestamps.

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @language-drill/db exec vitest run src/mastery/rebuild.test.ts`
Expected: PASS — the five new cases plus every pre-existing case.

If a pre-existing delete test now fails, do not weaken it: an incidental-only point is now legitimately *present* in both replays, so it is correctly no longer stale. Confirm that is the reason before touching anything.

- [ ] **Step 6: Add the idempotence test**

```ts
  it('is idempotent — replaying identical inputs twice yields identical shifts', async () => {
    const inputs = {
      history: [
        { userId: 'u1', language: 'TR', grammarPointKey: 'p', score: 0.9, difficulty: 'A1',
          evaluatedAt: new Date('2026-01-01'), evidenceWeight: null, demotionReason: null },
      ],
      observations: [
        { userId: 'u1', language: 'TR', hostGrammarPointKey: 'p', errorGrammarPointKey: 'q',
          severity: 'minor' as const, occurredAt: new Date('2026-01-01'), exerciseHistoryId: 'h1',
          difficulty: 'A1', demotionReason: null },
      ],
      existing: [],
    };
    const a = await run(fakeDb(inputs), { apply: false, includeDemoted: false });
    const b = await run(fakeDb(inputs), { apply: false, includeDemoted: false });
    expect(a.diff.shifts).toEqual(b.diff.shifts);
    expect(a.deletes).toBe(b.deletes);
  });
```

Run the file again; expected PASS.

- [ ] **Step 7: Add the fidelity test — replay must equal the live fold**

This is the test that pins the whole feature: a merged replay must produce what
the live submit path produces by calling `updateMastery` once per observation,
host first then incidental.

```ts
  it('matches what the live submit path folds call-by-call', async () => {
    // The live path: applyGrammarMastery(host) then, for each incidental
    // observation, applyGrammarMastery(incidental) — each folding into the
    // stored row. A faithful replay of the same events must land on the same
    // number. If this drifts, every nightly rebuild silently rewrites scores.
    const at = new Date('2026-01-01');
    const live = updateMastery(
      updateMastery(null, { score: 0.9, difficulty: CefrLevel.A1, at }),
      { score: SEVERITY_SCORE.minor, difficulty: CefrLevel.A1, at },
    );

    const result = await run(fakeDb({
      history: [
        { userId: 'u1', language: 'TR', grammarPointKey: 'p', score: 0.9, difficulty: 'A1',
          evaluatedAt: at, evidenceWeight: null, demotionReason: null },
      ],
      observations: [
        { userId: 'u1', language: 'TR', hostGrammarPointKey: 'host', errorGrammarPointKey: 'p',
          severity: 'minor', occurredAt: at, exerciseHistoryId: 'h1',
          difficulty: 'A1', demotionReason: null },
      ],
      existing: [],
    }), { apply: false, includeDemoted: false });

    const shift = result.diff.shifts.find((s) => s.grammarPointKey === 'p')!;
    expect(shift.to).toBeCloseTo(live.masteryScore, 10);
  });
```

Import `updateMastery`, `SEVERITY_SCORE` and `CefrLevel` in the test file if not
already present. Run the file; expected PASS. If it fails, the ordering or the
severity mapping is wrong — fix the source, not the expectation.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/mastery/rebuild.ts packages/db/src/mastery/rebuild.test.ts
git commit -m "fix(db): fold incidental observations into the mastery replay"
```

---

### Task 5: Delete-count circuit breaker

**Files:**
- Modify: `packages/db/src/mastery/rebuild.ts` (`RunOptions`, `run`)
- Modify: `packages/db/src/mastery/rebuild.test.ts`
- Modify: `packages/db/scripts/backfill-mastery.ts` (pass `maxDeletes: null`)

**Interfaces:**
- Produces: `RunOptions` gains `maxDeletes?: number | null` — `null`/absent means unbounded. `RunResult` gains `aborted: boolean`. When the breaker trips, `run` writes nothing and returns `aborted: true` with the computed counts intact.

- [ ] **Step 1: Write the failing tests**

Build the fixture by copying the one in the existing test
`'deletes the stale row and reports upserts/deletes separately when --apply is set'`
(in `describe('run — zero-evidence stale-row deletion, end to end against a fake Db')`,
around line 439 of the moved file) and repeating its stale point three times as
`p1`, `p2`, `p3` — i.e. three existing mastery rows whose only history rows all
carry a `demotionReason` of `'quality'`.

```ts
describe('delete circuit breaker', () => {
  const threeDeletable = /* the fixture described above */;

  it('applies normally when deletions are at the threshold', async () => {
    const result = await run(fakeDb(threeDeletable), { apply: true, includeDemoted: false, maxDeletes: 3 });
    expect(result.aborted).toBe(false);
    expect(result.deletes).toBe(3);
  });

  it('writes NOTHING when deletions exceed the threshold', async () => {
    const db = fakeDb(threeDeletable);
    const result = await run(db, { apply: true, includeDemoted: false, maxDeletes: 2 });
    expect(result.aborted).toBe(true);
    expect(result.deletes).toBe(3);
    // The whole run aborts — no partial apply. Upserts must not have run either.
    expect(db.insertCalls).toBe(0);
    expect(db.deleteCalls).toBe(0);
  });

  it('is unbounded when maxDeletes is null', async () => {
    const result = await run(fakeDb(threeDeletable), { apply: true, includeDemoted: false, maxDeletes: null });
    expect(result.aborted).toBe(false);
  });
});
```

Extend the fake `Db` to count `insert` and `delete` calls if it does not already.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @language-drill/db exec vitest run src/mastery/rebuild.test.ts`
Expected: FAIL — `aborted` is not on `RunResult`.

- [ ] **Step 3: Implement**

Add to `RunOptions`:

```ts
  /**
   * Abort the run if it would delete more than this many mastery rows. `null`
   * or absent means unbounded. The scheduled Lambda sets it; the CLI leaves it
   * null because a human reads its dry-run first. Deletion is the only
   * irreversible thing this does, so an unattended run stops rather than
   * guessing when the count looks systemic.
   */
  maxDeletes?: number | null;
```

Add `aborted: boolean` to `RunResult`. Then, immediately after `staleRows` is computed and **before** the upsert loop:

```ts
  const maxDeletes = opts.maxDeletes ?? null;
  const aborted = apply && maxDeletes !== null && staleRows.length > maxDeletes;
```

Guard both write loops with `if (apply && !aborted)`, and return `aborted` in the result. The shifts and diff are still computed, so the caller can log exactly what was refused.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @language-drill/db exec vitest run src/mastery/rebuild.test.ts`
Expected: PASS.

- [ ] **Step 5: Keep the CLI unbounded**

In `packages/db/scripts/backfill-mastery.ts`'s `main()`, pass `maxDeletes: null` explicitly in the `run(...)` options, with a short comment saying the CLI is human-gated by its dry-run.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/mastery packages/db/scripts/backfill-mastery.ts
git commit -m "feat(db): abort a mastery rebuild that would delete more than maxDeletes"
```

---

### Task 6: Lambda handler and CDK construct

**Files:**
- Create: `infra/lambda/src/mastery/rebuild-handler.ts`, `infra/lambda/src/mastery/rebuild-handler.test.ts`
- Create: `infra/lib/constructs/mastery-rebuild-lambda.ts`, `infra/lib/constructs/mastery-rebuild-lambda.test.ts`
- Modify: `infra/lib/stack.ts`, `infra/bin/app.ts`

**Interfaces:**
- Consumes: `run`, `summarize`, `formatDiffReport`, `RunResult` from `@language-drill/db`.
- Produces: `handler` (no-arg async), `MasteryRebuildLambdaConstruct` with props `{ secretsPrefix: string; enableScheduledJobs: boolean; maxDeletes?: number; scheduleExpression?: events.Schedule }`.

- [ ] **Step 1: Write the handler test**

`infra/lambda/src/mastery/rebuild-handler.test.ts` — mock `@language-drill/db` so no database is touched:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const runMock = vi.fn();
vi.mock('@language-drill/db', () => ({
  createDb: () => ({}),
  requireEnv: (k: string) => (k === 'DATABASE_URL' ? 'postgres://stub' : ''),
  run: (...args: unknown[]) => runMock(...args),
  summarize: () => 'summary',
  formatDiffReport: () => 'diff',
}));

beforeEach(() => { runMock.mockReset(); delete process.env['MASTERY_REBUILD_MAX_DELETES']; });

describe('mastery rebuild handler', () => {
  it('applies with the default delete threshold of 5', async () => {
    runMock.mockResolvedValue({ upserts: 1, deletes: 0, groupCount: 1, historyRowCount: 1, aborted: false, diff: { shifts: [], existingKeys: new Set(), deleted: [] } });
    const { handler } = await import('./rebuild-handler');
    await handler();
    expect(runMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apply: true, includeDemoted: false, maxDeletes: 5 }));
  });

  it('honours MASTERY_REBUILD_MAX_DELETES', async () => {
    process.env['MASTERY_REBUILD_MAX_DELETES'] = '12';
    runMock.mockResolvedValue({ upserts: 0, deletes: 0, groupCount: 0, historyRowCount: 0, aborted: false, diff: { shifts: [], existingKeys: new Set(), deleted: [] } });
    const { handler } = await import('./rebuild-handler');
    await handler();
    expect(runMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxDeletes: 12 }));
  });

  it('throws when the run aborted, so the Lambda Errors metric alarms', async () => {
    runMock.mockResolvedValue({ upserts: 0, deletes: 9, groupCount: 1, historyRowCount: 1, aborted: true, diff: { shifts: [], existingKeys: new Set(), deleted: [{ userId: 'u1', language: 'TR', grammarPointKey: 'p' }] } });
    const { handler } = await import('./rebuild-handler');
    await expect(handler()).rejects.toThrow(/aborted/i);
  });
});
```

Use `vi.resetModules()` between cases if the handler caches module-scope state.

- [ ] **Step 2: Run to verify it fails**

Run: `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda exec vitest run src/mastery/rebuild-handler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

```ts
/**
 * Nightly mastery rebuild. Replays every learner's evidence — host history
 * plus incidental error observations — and rewrites user_grammar_mastery, so
 * stored scores self-heal after a demotion revokes evidence. Read-time
 * surfaces already re-derive per request; this is for the stored table.
 *
 * DATABASE_URL only. No Claude, no cost beyond Postgres.
 */
import { createDb, requireEnv, run, summarize, formatDiffReport } from '@language-drill/db';

const DEFAULT_MAX_DELETES = 5;

const db = createDb(requireEnv('DATABASE_URL'));

function log(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload));
}

export async function handler(): Promise<void> {
  const raw = process.env['MASTERY_REBUILD_MAX_DELETES'];
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  const maxDeletes = Number.isFinite(parsed) ? parsed : DEFAULT_MAX_DELETES;

  const result = await run(db, { apply: true, includeDemoted: false, maxDeletes });

  log({
    event: 'mastery_rebuild',
    aborted: result.aborted,
    upserts: result.upserts,
    deletes: result.deletes,
    groups: result.groupCount,
    observations: result.historyRowCount,
    maxDeletes,
  });
  console.log(summarize({ apply: !result.aborted, upserts: result.upserts, deletes: result.deletes, groupCount: result.groupCount, historyRowCount: result.historyRowCount, includeDemoted: false }));
  console.log(formatDiffReport(result.diff));

  if (result.aborted) {
    // Nothing was written. Throwing increments the Lambda Errors metric, which
    // raises the operational alarm — a run this anomalous wants a human.
    log({ event: 'mastery_rebuild_aborted', deletes: result.deletes, maxDeletes, rows: result.diff.deleted });
    throw new Error(
      `Mastery rebuild aborted: would delete ${result.deletes} rows, above the ${maxDeletes} threshold. Nothing was written.`,
    );
  }
}
```

Check `summarize`'s exact parameter object against `rebuild.ts` and match it; adjust if the signature differs.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm build && rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda exec vitest run src/mastery/rebuild-handler.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the CDK synth test**

`infra/lib/constructs/mastery-rebuild-lambda.test.ts`, modelled on `theory-scheduler-lambda.test.ts`:

```ts
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { MasteryRebuildLambdaConstruct } from './mastery-rebuild-lambda';

function buildStack(enableScheduledJobs: boolean): Template {
  const app = new App();
  const stack = new Stack(app, 'TestStack');
  new MasteryRebuildLambdaConstruct(stack, 'MasteryRebuildLambda', {
    secretsPrefix: 'language-drill-dev',
    enableScheduledJobs,
  });
  return Template.fromStack(stack);
}

describe('MasteryRebuildLambdaConstruct', () => {
  it('creates exactly one daily 03:00 UTC rule when scheduling is enabled', () => {
    const t = buildStack(true);
    t.resourceCountIs('AWS::Events::Rule', 1);
    t.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'cron(0 3 * * ? *)',
    });
  });

  it('creates the Lambda but no rule when scheduling is disabled', () => {
    const t = buildStack(false);
    t.resourceCountIs('AWS::Events::Rule', 0);
    t.resourceCountIs('AWS::Lambda::Function', 1);
  });

  it('wires DATABASE_URL and never the Anthropic key', () => {
    const t = buildStack(true);
    t.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ DATABASE_URL: Match.anyValue() }) },
    });
    const fns = t.findResources('AWS::Lambda::Function');
    for (const fn of Object.values(fns)) {
      expect(JSON.stringify(fn)).not.toContain('ANTHROPIC_API_KEY');
    }
  });
});
```

- [ ] **Step 6: Write the construct**

`infra/lib/constructs/mastery-rebuild-lambda.ts`, copying the structure of `email-dispatcher-lambda.ts` exactly (same runtime, bundling aliases, log retention) with these differences: entry `../../lambda/src/mastery/rebuild-handler.ts`; no SQS queue or grant; environment `DATABASE_URL` plus `MASTERY_REBUILD_MAX_DELETES: String(props.maxDeletes ?? 5)`; default schedule `events.Schedule.cron({ minute: '0', hour: '3' })`; rule description `'Nightly mastery rebuild — replays evidence so stored mastery self-heals after demotions.'`. Timeout 300 seconds, memory 512 MB — a full replay is larger than a dispatcher fan-out.

Document in the class doc comment why the rule is gated and why the Lambda is created unconditionally (dev invokes it manually), matching the sibling constructs' tone.

- [ ] **Step 7: Run the synth test**

Run: `pnpm --filter @language-drill/infra exec vitest run lib/constructs/mastery-rebuild-lambda.test.ts`
Expected: PASS. If it fails with an esbuild exit-254 error, that is environmental — esbuild must be resolvable from the repo root; note it and re-run rather than changing the construct.

- [ ] **Step 8: Wire it into the stack**

In `infra/lib/stack.ts`, import the construct and instantiate it beside `EmailDispatcherLambdaConstruct`, passing `secretsPrefix` and `enableScheduledJobs: props.enableScheduledJobs`. Do **not** gate it on `enableScheduledExerciseGeneration` — that flag exists to pause AI spend, and this job costs nothing.

No change to `infra/bin/app.ts` is needed unless you add a per-env `maxDeletes` override; leave it on the default.

- [ ] **Step 9: Full gate and commit**

Run: `pnpm lint && pnpm typecheck && rm -rf infra/lambda/dist && pnpm test`
Expected: zero failures. Report the actual counts.

```bash
git add infra
git commit -m "feat(infra): nightly mastery rebuild Lambda on a 03:00 UTC schedule"
```

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md`, `docs/runbooks/prompt-update-and-revalidate.md`

- [ ] **Step 1: Update the runbook**

`docs/runbooks/prompt-update-and-revalidate.md` §7 currently instructs the reader to run `backfill:mastery` after a quality demotion. Add, in that section's existing voice, that a nightly Lambda now does this at 03:00 UTC, so the manual run is only needed when the correction cannot wait until the next night. Keep the manual commands — they remain the tool for an immediate fix and for `--include-demoted` rollback.

Also correct the section's admin-UI paragraph: it currently warns that admin demotions leave stored mastery stale indefinitely. That is now bounded at 24 hours.

- [ ] **Step 2: Add a CLAUDE.md row**

In the "Running Locally" command table, after the `pnpm backfill:demotion-reason` row:

```markdown
| `pnpm backfill:mastery` | Rebuild `user_grammar_mastery` by replaying every learner's evidence — host history **and** incidental error observations. Dry-run by default; `--apply` writes; `--include-demoted` restores the pre-#629 evidence selection (the rollback path). Can **delete** rows whose every attempt was on a defect-demoted exercise. A nightly Lambda runs the same core at 03:00 UTC with a 5-row delete circuit breaker, so manual runs are only for immediate corrections. |
```

- [ ] **Step 3: Note the schedule where the others are listed**

Search `CLAUDE.md` for the existing description of scheduled jobs (the theory-generation weekly cron and the exercise-generation nightly cron are mentioned in the memory of this project's docs; if a scheduled-jobs list exists, add the 03:00 UTC mastery rebuild to it — if none exists, skip this step rather than inventing a section).

- [ ] **Step 4: Verify the claims**

Run: `rg -n "03:00|hour: '3'" infra/lib/constructs/mastery-rebuild-lambda.ts`
Expected: the schedule matches what the docs now claim.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/runbooks/prompt-update-and-revalidate.md
git commit -m "docs: document the nightly mastery rebuild"
```

---

### Task 8: Verify against production

**This task writes to production and is human-gated.** Every write step is preceded by a dry-run whose output must be reported. Stop and report rather than improvising if a number disagrees.

- [ ] **Step 1: Open the PR and merge**

Push, open a PR summarising the fidelity fix and the schedule, land it, and confirm the Production Deploy workflow goes green. The deploy creates the Lambda and, in prod, the EventBridge rule.

- [ ] **Step 2: Capture the pre-run baseline**

Against prod, read-only:

```sql
SELECT count(*) AS rows, count(DISTINCT user_id) AS users FROM user_grammar_mastery;
SELECT grammar_point_key, round(mastery_score::numeric,4) AS score, evidence_count
  FROM user_grammar_mastery ORDER BY grammar_point_key;
```

Save the output. It is the before-half and the rollback reference.

- [ ] **Step 3: Dry-run the fidelity-fixed rebuild**

```bash
DATABASE_URL='<prod>' pnpm --filter @language-drill/db backfill:mastery
```

Expected: **visible movement** — this run restores incidental contributions on roughly 22 grammar points, so a non-trivial diff is correct here. Deletions should be 0. Report the diff before proceeding.

- [ ] **Step 4: Apply**

Same command with `--apply`. Confirm the applied counts match the dry-run exactly.

- [ ] **Step 5: Prove the invariant**

Immediately re-run the dry-run. Expected: **0 moved, 0 new, 0 deleted** — a faithful replay is a no-op on an unchanged database. This is the acceptance criterion for the whole feature.

If it reports movement, the replay still disagrees with the live path. Do not enable the schedule; report the diff and stop.

- [ ] **Step 6: Confirm the first scheduled run**

The morning after the deploy, read the Lambda's CloudWatch logs for the `mastery_rebuild` event. Expected: `aborted: false`, small or zero `upserts` movement, `deletes: 0`.

- [ ] **Step 7: Report**

Report the before/after table, the two dry-run diffs (step 3 and step 5), and the first scheduled run's log line.

---

## Rollback

- **Stop the schedule:** set `enableScheduledJobs` false for the env, or remove the rule, and redeploy. The Lambda remains, invocable manually.
- **Undo a bad rebuild:** `backfill:mastery --apply --include-demoted` restores the pre-#629 evidence selection.
- **Undo the fidelity change:** revert the branch. Nothing here is a migration; no schema changes at all.
