# Scheduler Finishing Reserve + Fair-Share Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the nightly generation scheduler from indefinitely starving near-complete cells (and let near-saturated languages release slots to a language with real backlog) by adding a closest-first "finishing reserve" to the pure fan-out selector.

**Architecture:** Extend `selectCellsWithinCaps` (pure) to partition under-target cells by a need threshold `T`: carve up to `R` slots for **finishers** (`need ≤ T`) ordered closest-to-done first, then run the *existing* per-language fair-share on the remaining **main cells** (`need > T`) with the reduced budget, then fill any residual budget with leftover finishers. `scheduler.ts` resolves `T`/`R` from env with the existing fat-finger guard and passes them in. Ships with the Lambda code deploy — no Langfuse sync, no curriculum-version bump.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces (`@language-drill/lambda` = `infra/lambda`), AWS Lambda (EventBridge-invoked scheduler).

## Global Constraints

- Package under change is `@language-drill/lambda` at `infra/lambda`. It must **not** import `@language-drill/db` in a way that creates a build cycle — this change touches only `generation/` files that already import from `@language-drill/db`, so no new cross-package edges.
- The selector `selectCellsWithinCaps` (and its helpers) stays **pure**: no I/O, no `process.env`, no AWS SDK, no clock, no randomness. Env resolution lives only in `scheduler.ts`.
- Selection stays **deterministic**: order by `need` then `cellKey` ascending as the sole tie-break.
- Env override guards mirror the existing `resolveMaxCellsPerRun` pattern exactly: `Number.parseInt(raw, 10)`; a non-integer, zero, or negative value falls back to the default so a fat-fingered env var can never disable the mechanism.
- Defaults: `SCHEDULER_FINISHING_NEED_THRESHOLD = 5`, `SCHEDULER_FINISHING_RESERVE_SLOTS = 8`.
- Full pre-push gate from repo root must pass with zero failures: `pnpm lint`, `pnpm typecheck`, `pnpm test`. Before the full `pnpm test`, delete stale compiled Lambda test files: `rm -rf infra/lambda/dist` (stale `dist/**/*.test.js` produce phantom failures under the full suite).
- All work happens in the worktree `.claude/worktrees/scheduler-finishing-reserve` on branch `fix/scheduler-finishing-reserve`. Assert the branch before every commit.

---

## File Structure

- `infra/lambda/src/generation/cell-selection.ts` — **modify.** New signature (two extra params), a partition, a `byNeedAsc` comparator, an extracted `fairShareSelect` helper (the current reserve/trim/redistribute body, unchanged), and the four-phase `selectCellsWithinCaps`.
- `infra/lambda/src/generation/cell-selection.test.ts` — **modify.** Append the two new args to existing calls (disable finishing via `0, 0` so they keep testing pure fair-share); add new cases for finishing behavior.
- `infra/lambda/src/generation/scheduler.ts` — **modify.** Two `resolveFinishing*` helpers + two default constants; pass the resolved values into `selectCellsWithinCaps`; add both to the cap-applied log line.
- `infra/lambda/src/generation/scheduler.test.ts` — **modify.** One existing test updated (`need 5 → 7`); new integration test that a finisher survives contention; new guard test.

---

## Task 1: Finishing reserve in the pure selector

**Files:**
- Modify: `infra/lambda/src/generation/cell-selection.ts`
- Test: `infra/lambda/src/generation/cell-selection.test.ts`

**Interfaces:**
- Consumes: `CellNeed { cell: { language: string; cellKey: string }; need: number }`, `CellSelectionResult<T>` (both already exported, unchanged).
- Produces: `selectCellsWithinCaps<T extends CellNeed>(undersized: readonly T[], globalCap: number, perLangCap: number, finishingThreshold: number, finishingReserveSlots: number): CellSelectionResult<T>` — two new **required** trailing params. Task 2 (scheduler) relies on this exact signature.

- [ ] **Step 1: Write the failing tests**

Add these cases inside the existing `describe('selectCellsWithinCaps', …)` block in `cell-selection.test.ts`. The `items(lang, count, baseNeed)` helper already exists; pass an explicit `baseNeed` for finishers.

```ts
  it('reserves closest-to-done finishers under contention (today’s scenario)', () => {
    // 58 DE main cells (need 20) + 8 DE finishers (need 1..5) + 50 ES finishers
    // (need 2). globalCap 120, perLangCap 50, T=5, R=8.
    const deMain = items('DE', 58, 20);
    const deFinishers: CellNeed[] = Array.from({ length: 8 }, (_, i) => ({
      cell: { language: 'DE', cellKey: `de:fin:${String(i).padStart(3, '0')}` },
      need: (i % 5) + 1, // needs 1..5
    }));
    const esFinishers = items('ES', 50, 2);
    const under = [...deMain, ...deFinishers, ...esFinishers];

    const r = selectCellsWithinCaps(under, 120, 50, 5, 8);

    // No language starves: every DE finisher (need ≤ 5) is served.
    const selectedKeys = new Set(r.selected.map((s) => s.cell.cellKey));
    for (const f of deFinishers) {
      expect(selectedKeys.has(f.cell.cellKey)).toBe(true);
    }
    // DE high-need overflow redistributes past the 50-cell reserve because ES
    // finishers no longer consume ES’s per-language reserve.
    const by = langsOf(r.selected);
    expect(by['DE']).toBeGreaterThan(50);
    expect(r.selected).toHaveLength(120);
  });

  it('guarantees the finishing reserve even when main cells alone exceed the cap', () => {
    // Main cells (need 40) already overflow the global cap; finishers must still
    // get their R reserved slots (carved before the main fill).
    const main = items('DE', 200, 40);
    const finishers = items('ES', 20, 3);
    const r = selectCellsWithinCaps([...main, ...finishers], 10, 50, 5, 4);
    const by = langsOf(r.selected);
    expect(r.selected).toHaveLength(10);
    expect(by['ES']).toBe(4); // R=4 finishers reserved despite DE flooding
    expect(by['DE']).toBe(6); // remaining 6 slots to the main backlog
  });

  it('orders the finishing reserve closest-to-done first (need asc)', () => {
    // Two finishers, one reserve slot: the lower-need one (closer to done) wins.
    const under: CellNeed[] = [
      { cell: { language: 'DE', cellKey: 'de:need5' }, need: 5 },
      { cell: { language: 'DE', cellKey: 'de:need1' }, need: 1 },
      ...items('DE', 5, 40), // main backlog to fill the rest
    ];
    const r = selectCellsWithinCaps(under, 3, 50, 5, 1);
    const keys = r.selected.map((s) => s.cell.cellKey);
    expect(keys).toContain('de:need1'); // closest-to-done reserved
    expect(keys).not.toContain('de:need5'); // outranked in the single reserve slot
  });

  it('does not double-count a reserved finisher and reports exact deferred count', () => {
    const finishers = items('DE', 6, 2); // 6 finishers
    const main = items('ES', 4, 30);
    const under = [...finishers, ...main]; // 10 cells
    const r = selectCellsWithinCaps(under, 8, 50, 5, 3);
    const keys = r.selected.map((s) => s.cell.cellKey);
    expect(new Set(keys).size).toBe(keys.length); // no duplicates
    expect(r.selected).toHaveLength(8);
    expect(r.deferredCount).toBe(10 - 8);
  });

  it('fills residual budget with leftover finishers on a light night', () => {
    // 2 main + 5 finishers, cap 10: reserve 3 finishers, main takes 2, the
    // remaining 2 finishers fill residual budget — nothing wasted.
    const main = items('DE', 2, 30);
    const finishers = items('ES', 5, 4);
    const r = selectCellsWithinCaps([...main, ...finishers], 10, 50, 5, 3);
    expect(r.selected).toHaveLength(7); // all 7 fit
    expect(r.deferredCount).toBe(0);
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `pnpm --filter @language-drill/lambda test -- cell-selection`
Expected: FAIL — the existing 3-arg `selectCellsWithinCaps` rejects the extra args / the finishing behavior is absent (TypeScript arity error or assertion failures).

- [ ] **Step 3: Implement the new selector**

Replace the body of `cell-selection.ts` from the `byNeedDesc` helper through the end of `selectCellsWithinCaps` with the following. Keep the module-level doc comment at the top; update its "two-phase" wording to mention the finishing reserve (a one-line edit — see Step 3b).

```ts
/** need desc, then cellKey asc — the deterministic ordering for the backlog. */
function byNeedDesc(a: CellNeed, b: CellNeed): number {
  return b.need - a.need || a.cell.cellKey.localeCompare(b.cell.cellKey);
}

/** need asc, then cellKey asc — closest-to-done first, for the finishing reserve. */
function byNeedAsc(a: CellNeed, b: CellNeed): number {
  return a.need - b.need || a.cell.cellKey.localeCompare(b.cell.cellKey);
}

function countByLanguage(items: readonly CellNeed[]): Record<string, number> {
  const by: Record<string, number> = {};
  for (const item of items) {
    by[item.cell.language] = (by[item.cell.language] ?? 0) + 1;
  }
  return by;
}

/**
 * The per-language fair-share pass: reserve up to `perLangCap` highest-need
 * cells per language, trim to `globalCap` by need under contention, else
 * redistribute unused global slots from the leftover. Extracted verbatim from
 * the former `selectCellsWithinCaps` body so the main-cell pass reuses it.
 */
function fairShareSelect<T extends CellNeed>(
  cells: readonly T[],
  globalCap: number,
  perLangCap: number,
): T[] {
  const byLanguage = new Map<string, T[]>();
  for (const item of cells) {
    const group = byLanguage.get(item.cell.language);
    if (group) group.push(item);
    else byLanguage.set(item.cell.language, [item]);
  }

  const reserved: T[] = [];
  const leftover: T[] = [];
  for (const group of byLanguage.values()) {
    group.sort(byNeedDesc);
    reserved.push(...group.slice(0, perLangCap));
    leftover.push(...group.slice(perLangCap));
  }

  if (reserved.length >= globalCap) {
    reserved.sort(byNeedDesc);
    return reserved.slice(0, globalCap);
  }
  leftover.sort(byNeedDesc);
  return reserved
    .concat(leftover.slice(0, globalCap - reserved.length))
    .sort(byNeedDesc);
}

/**
 * Choose which under-target cells to enqueue. Partitions cells by
 * `finishingThreshold` into near-complete **finishers** (`need ≤ threshold`)
 * and **main cells**, then:
 *
 *   0. Finishing reserve — carve up to `finishingReserveSlots` global slots for
 *      finishers, closest-to-done first (need ASC), so near-complete cells close
 *      permanently instead of being perpetually outranked by the high-need tail.
 *   1–3. Fair-share (`fairShareSelect`) on the main cells with the remaining
 *      budget — unchanged. Excluding finishers from the per-language reserve
 *      means a near-saturated language stops burning `perLangCap` on need-1
 *      cells, so redistribution can free another language's high-need overflow.
 *   4. Fill any residual budget with leftover finishers (need DESC) so a light
 *      night still fills to `globalCap`.
 *
 * Pure and deterministic — need + cellKey tie-break, no clock, no randomness.
 */
export function selectCellsWithinCaps<T extends CellNeed>(
  undersized: readonly T[],
  globalCap: number,
  perLangCap: number,
  finishingThreshold: number,
  finishingReserveSlots: number,
): CellSelectionResult<T> {
  const finishers: T[] = [];
  const mainCells: T[] = [];
  for (const item of undersized) {
    if (item.need <= finishingThreshold) finishers.push(item);
    else mainCells.push(item);
  }

  // Phase 0 — finishing reserve, closest-to-done first, bounded by the global cap.
  finishers.sort(byNeedAsc);
  const reserveCount = Math.min(
    finishingReserveSlots,
    finishers.length,
    globalCap,
  );
  const reservedFinishers = finishers.slice(0, reserveCount);

  // Phases 1–3 — existing fair-share on the main backlog, budget net of phase 0.
  const mainBudget = globalCap - reservedFinishers.length;
  const mainSelected =
    mainBudget > 0 ? fairShareSelect(mainCells, mainBudget, perLangCap) : [];

  // Phase 4 — fill any residual budget with the leftover finishers.
  const residual = mainBudget - mainSelected.length;
  const extraFinishers =
    residual > 0
      ? finishers.slice(reserveCount).sort(byNeedDesc).slice(0, residual)
      : [];

  const selected = [...reservedFinishers, ...mainSelected, ...extraFinishers].sort(
    byNeedDesc,
  );

  return {
    selected,
    deferredCount: undersized.length - selected.length,
    enqueuedByLanguage: countByLanguage(selected),
  };
}
```

- [ ] **Step 3b: Update the module doc comment**

At the top of `cell-selection.ts`, the header comment describes a "two-phase fair-share." Add a sentence after the numbered Reserve/Contention/Redistribute list noting the new phase 0, e.g.:

```
 *   - **Finishing reserve (phase 0):** before the fair-share runs, carve up to
 *     `finishingReserveSlots` slots for near-complete cells (`need ≤
 *     finishingThreshold`), closest-to-done first, so a cell one draft from
 *     target isn't perpetually outranked by the chronic high-need tail.
```

- [ ] **Step 4: Update existing test call sites to the new arity**

Every existing call in `cell-selection.test.ts` passes 3 args. Append `, 0, 0` to each (threshold 0 ⇒ no finishers, reserve 0 ⇒ off — so these keep testing pure fair-share unchanged). There are 8 existing `selectCellsWithinCaps(...)` calls (the `it(...)` cases from "is a no-op…" through "behaves like a pure global cap…"). Example:

```ts
    // before
    const r = selectCellsWithinCaps(under, 120, 50);
    // after
    const r = selectCellsWithinCaps(under, 120, 50, 0, 0);
```

- [ ] **Step 5: Run the full file to verify all pass**

Run: `pnpm --filter @language-drill/lambda test -- cell-selection`
Expected: PASS — all existing invariant tests (with `0, 0`) plus the 5 new finishing tests are green.

- [ ] **Step 6: Commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/scheduler-finishing-reserve
test "$(git branch --show-current)" = "fix/scheduler-finishing-reserve" || { echo WRONG BRANCH; exit 1; }
git add infra/lambda/src/generation/cell-selection.ts infra/lambda/src/generation/cell-selection.test.ts
git commit -m "feat(scheduler): closest-first finishing reserve in cell selector

Partition under-target cells by a need threshold; carve up to R slots for
near-complete finishers (need<=T, closest-first) before the existing
per-language fair-share runs on the main backlog. Excluding finishers from
the per-language reserve also lets near-saturated languages release slots
to a language with real backlog.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wire the env-resolved knobs into the scheduler

**Files:**
- Modify: `infra/lambda/src/generation/scheduler.ts`
- Test: `infra/lambda/src/generation/scheduler.test.ts`

**Interfaces:**
- Consumes: `selectCellsWithinCaps(undersized, cap, perLanguageCap, finishingThreshold, finishingReserveSlots)` from Task 1.
- Produces: nothing new exported — internal `resolveFinishingThreshold()` / `resolveFinishingReserveSlots()` and two default constants, plus two new keys (`finishingThreshold`, `finishingReserveSlots`) on the existing "cap applied" log line.

- [ ] **Step 1: Update the one existing test whose subject becomes a finisher**

In `scheduler.test.ts`, the test `'enqueues the most under-target cells first (need desc, cellKey tie-break)'` (in `describe('scheduler run-level cell cap', …)`) sets `subjects[0]` to `approved 45` (need 5). With the default threshold `T=5`, need-5 is now a finisher and would be reserved, changing the result. Bump it out of the finisher band so the test keeps asserting pure need-desc ordering:

```ts
    const approvedByKey = new Map<string, number>([
      [subjects[0].cellKey, 43], // need 7  (was 45 / need 5 — keep it a MAIN cell
                                 //          so this test still checks need-desc)
      [subjects[1].cellKey, 10], // need 40  ← 1st
      [subjects[2].cellKey, 30], // need 20
      [subjects[3].cellKey, 20], // need 30  ← 2nd
      [subjects[4].cellKey, 40], // need 10
    ]);
```

The expected result is unchanged: `[jobIdFor(subjects[1]), jobIdFor(subjects[3])]`, `deferredCount` 3.

- [ ] **Step 2: Write the failing tests**

Add to the `describe('scheduler run-level cell cap', …)` block. The `afterEach` in that block already deletes `SCHEDULER_MAX_CELLS_*`; extend it to also clear the finishing vars (add the two `delete` lines). Then:

```ts
  it('reserves a slot for a near-complete finisher under contention', async () => {
    // Global cap 3, default perLang 50 / T=5 / R=8. Three DE cells at need 50
    // plus one DE finisher at need 3. A pure need-desc cap 3 would take the
    // three need-50 cells and defer the finisher; the reserve keeps it.
    process.env['SCHEDULER_MAX_CELLS_PER_RUN'] = '3';
    const de = cellsWithGlobalTarget()
      .filter((c) => c.language === 'DE')
      .slice(0, 4);
    expect(de).toHaveLength(4);
    const approvedByKey = new Map<string, number>([
      [de[0].cellKey, 0], // need 50
      [de[1].cellKey, 0], // need 50
      [de[2].cellKey, 0], // need 50
      [de[3].cellKey, 47], // need 3 — finisher
    ]);
    const rows = allRoundOneCells().map((cell) => ({
      language: cell.language,
      difficulty: cell.cefrLevel,
      type: cell.exerciseType,
      grammarPointKey: cell.grammarPoint.key,
      approved: approvedByKey.get(cell.cellKey) ?? resolveCellTarget(cell),
    }));
    mockGroupBy.mockResolvedValueOnce(rows);

    await handler();

    const today = new Date().toISOString().slice(0, 10);
    const jobIdFor = (cell: Cell) =>
      deterministicUuid([cell.cellKey, `scheduled-${today}`].join('|'));
    const ids = enqueuedJobIds();
    expect(ids).toHaveLength(3);
    expect(ids).toContain(jobIdFor(de[3])); // finisher reserved, not deferred
    const log = capLogLine();
    expect(log!['finishingThreshold']).toBe(5);
    expect(log!['finishingReserveSlots']).toBe(8);
    expect(log!['deferredCount']).toBe(1);
  });

  it('ignores a non-numeric finishing override and falls back to the defaults', async () => {
    process.env['SCHEDULER_FINISHING_NEED_THRESHOLD'] = 'nope';
    process.env['SCHEDULER_FINISHING_RESERVE_SLOTS'] = '-4';
    process.env['SCHEDULER_MAX_CELLS_PER_RUN'] = '3';
    const de = cellsWithGlobalTarget()
      .filter((c) => c.language === 'DE')
      .slice(0, 4);
    const approvedByKey = new Map<string, number>([
      [de[0].cellKey, 0],
      [de[1].cellKey, 0],
      [de[2].cellKey, 0],
      [de[3].cellKey, 47], // need 3 — still a finisher under the DEFAULT T=5
    ]);
    const rows = allRoundOneCells().map((cell) => ({
      language: cell.language,
      difficulty: cell.cefrLevel,
      type: cell.exerciseType,
      grammarPointKey: cell.grammarPoint.key,
      approved: approvedByKey.get(cell.cellKey) ?? resolveCellTarget(cell),
    }));
    mockGroupBy.mockResolvedValueOnce(rows);

    await handler();

    const log = capLogLine();
    expect(log!['finishingThreshold']).toBe(5); // fell back to default
    expect(log!['finishingReserveSlots']).toBe(8); // fell back to default
  });
```

Also extend the block's `afterEach`:

```ts
  afterEach(() => {
    delete process.env['SCHEDULER_MAX_CELLS_PER_RUN'];
    delete process.env['SCHEDULER_MAX_CELLS_PER_LANGUAGE'];
    delete process.env['SCHEDULER_FINISHING_NEED_THRESHOLD'];
    delete process.env['SCHEDULER_FINISHING_RESERVE_SLOTS'];
  });
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `pnpm --filter @language-drill/lambda test -- scheduler.test`
Expected: FAIL — `handler` still calls `selectCellsWithinCaps` with 3 args (arity error) and the log line lacks `finishingThreshold` / `finishingReserveSlots`.

- [ ] **Step 4: Implement the wiring**

In `scheduler.ts`, add two default constants next to `DEFAULT_MAX_CELLS_PER_LANGUAGE`:

```ts
/**
 * Finishing reserve (2026-07-24): a cell with `need ≤` this threshold is
 * "near-complete" and eligible for the closest-first reserve carved before the
 * fair-share pass. Overridable via `SCHEDULER_FINISHING_NEED_THRESHOLD`.
 * See docs/analysis/generation-run-2026-07-24.md and `selectCellsWithinCaps`.
 */
const DEFAULT_FINISHING_NEED_THRESHOLD = 5;

/**
 * Up to this many global slots per run are reserved for finishers, closest-to-
 * done first, so near-complete cells close instead of being perpetually
 * outranked by the chronic high-need tail. Overridable via
 * `SCHEDULER_FINISHING_RESERVE_SLOTS`.
 */
const DEFAULT_FINISHING_RESERVE_SLOTS = 8;
```

Add two resolver functions next to `resolveMaxCellsPerLanguage` (same fat-finger guard):

```ts
/**
 * Resolve the finishing-reserve need threshold from the environment. Same
 * fat-finger guard as the cap resolvers — a non-positive / non-numeric value
 * falls back to the default so the reserve can never be silently disabled.
 */
function resolveFinishingThreshold(): number {
  const raw = process.env['SCHEDULER_FINISHING_NEED_THRESHOLD'];
  if (raw === undefined) return DEFAULT_FINISHING_NEED_THRESHOLD;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_FINISHING_NEED_THRESHOLD;
}

/** Resolve the finishing-reserve slot count from the environment (same guard). */
function resolveFinishingReserveSlots(): number {
  const raw = process.env['SCHEDULER_FINISHING_RESERVE_SLOTS'];
  if (raw === undefined) return DEFAULT_FINISHING_RESERVE_SLOTS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_FINISHING_RESERVE_SLOTS;
}
```

In `handler`, at the selection call site (currently building `cap` / `perLanguageCap`), resolve and pass the two new values:

```ts
  const cap = resolveMaxCellsPerRun();
  const perLanguageCap = resolveMaxCellsPerLanguage();
  const finishingThreshold = resolveFinishingThreshold();
  const finishingReserveSlots = resolveFinishingReserveSlots();
  const {
    selected: selectedCells,
    deferredCount,
    enqueuedByLanguage,
  } = selectCellsWithinCaps(
    undersized,
    cap,
    perLanguageCap,
    finishingThreshold,
    finishingReserveSlots,
  );
  if (deferredCount > 0) {
    log({
      level: 'info',
      cap,
      perLanguageCap,
      finishingThreshold,
      finishingReserveSlots,
      enqueuedThisRun: selectedCells.length,
      enqueuedByLanguage,
      deferredCount,
      message:
        'run-level + per-language cap applied — deferring cells to a later run',
    });
  }
```

- [ ] **Step 5: Run the scheduler tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda test -- scheduler.test`
Expected: PASS — the updated ordering test, the two new finishing tests, and every pre-existing scheduler test are green.

- [ ] **Step 6: Commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/scheduler-finishing-reserve
test "$(git branch --show-current)" = "fix/scheduler-finishing-reserve" || { echo WRONG BRANCH; exit 1; }
git add infra/lambda/src/generation/scheduler.ts infra/lambda/src/generation/scheduler.test.ts
git commit -m "feat(scheduler): resolve finishing-reserve knobs from env and wire them in

SCHEDULER_FINISHING_NEED_THRESHOLD (default 5) and
SCHEDULER_FINISHING_RESERVE_SLOTS (default 8), same fat-finger guard as the
cap resolvers; passed into selectCellsWithinCaps and surfaced on the
cap-applied log line.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Full pre-push gate

**Files:** none (verification only).

- [ ] **Step 1: Clear stale compiled Lambda test files**

Run: `rm -rf infra/lambda/dist`
Why: the full suite otherwise runs stale `infra/lambda/dist/**/*.test.js` and reports phantom failures.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: zero errors.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors. (Confirms the new 5-arg signature is consistent at the `scheduler.ts` call site and every test call site.)

- [ ] **Step 4: Full test suite**

Run: `pnpm test`
Expected: all packages green. Report `X passed, Y failed`. If any `generation/` test fails, fix inline before proceeding — do not push.

- [ ] **Step 5: Push and open the PR**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/scheduler-finishing-reserve
test "$(git branch --show-current)" = "fix/scheduler-finishing-reserve" || { echo WRONG BRANCH; exit 1; }
git push -u origin fix/scheduler-finishing-reserve
```

Then open a PR (squash-merge) summarizing: the two starvation modes from `docs/analysis/generation-run-2026-07-24.md`, the closest-first finishing reserve, the fair-share side-effect (rec 2), and the two env knobs. Note the rec-3 adjective-declension carrier-phrase fix is a separate follow-up.

---

## Self-Review

**Spec coverage:**
- Finishing reserve (phase 0, closest-first) → Task 1, Step 3 + tests.
- Fair-share on main cells / rec 2 (finishers excluded from per-language reserve) → Task 1, Step 3 (`fairShareSelect` on `mainCells`) + the "today's scenario" test asserting `DE > 50`.
- Residual fill (phase 4) → Task 1, Step 3 + the "light night" test.
- New signature + purity/determinism → Task 1 interface block + Global Constraints.
- Env resolution with fat-finger guard, defaults 5/8 → Task 2, Step 4 + guard test.
- Log-line surfacing → Task 2, Step 4 + the finisher test's `finishingThreshold`/`finishingReserveSlots` assertions.
- Preserved invariants → Task 1, Step 4 (existing tests kept via `0, 0`) + Task 3 full gate.
- Rollout / no curriculum bump / stale-dist gotcha → Global Constraints + Task 3.

**Placeholder scan:** none — every code and command step is concrete.

**Type consistency:** `selectCellsWithinCaps(..., finishingThreshold, finishingReserveSlots)` used identically in Task 1 (definition), Task 1 tests, and Task 2 (call site). `fairShareSelect`, `byNeedAsc`, `resolveFinishingThreshold`, `resolveFinishingReserveSlots` referenced consistently. Log keys `finishingThreshold` / `finishingReserveSlots` match between the `scheduler.ts` log object and the `scheduler.test.ts` assertions.
