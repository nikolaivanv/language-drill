# Mastery Ceiling Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a single first observation from pinning a grammar point at `1.0` (or `0.0`), by seeding the first observation against a weak neutral prior instead of taking its raw score.

**Architecture:** `updateMastery` currently early-returns on `prev === null` with the raw score. Replace that branch with a virtual prior state (`masteryScore 0.5`, `evidenceCount 0.5`, `lastPracticedAt = obs.at`) fed through the *existing* averaging step — no new branch in the math, and the seed inherits the model's difficulty asymmetry for free. Then extend the existing backfill script to report an old→new diff so the production rebuild can be reviewed before it is applied.

**Tech Stack:** TypeScript, Vitest, Drizzle ORM, pnpm workspaces + Turborepo.

**Spec:** `docs/superpowers/specs/2026-08-08-mastery-ceiling-fix-design.md`

## Global Constraints

- `evidenceCount` counts **real** observations only. `PRIOR_PSEUDO_COUNT` is a weight and must never appear in the returned `evidenceCount` or in `confidence`. After one real observation, `confidence` must still be exactly `confidenceFor(1)`.
- Constant values, verbatim from the spec: `NEUTRAL_PRIOR = 0.5`, `PRIOR_PSEUDO_COUNT = 0.5`.
- Do **not** change `CORRECT_THRESHOLD`, `STEADY_EPS`, `STRONG_GAIN_DELTA`, `HALFLIFE_DAYS`, `K_EVIDENCE`, `DW_PIVOT`, or `DIFFICULTY_WEIGHTS`.
- No schema change, no migration, no UI or copy change in this plan.
- `packages/db` is consumed by `infra/lambda` through its **built `dist`**. After editing `packages/db/src`, run `pnpm --filter @language-drill/db build` before running any lambda test, or the lambda suite silently tests stale code.
- Pre-push gate, from the repo root, all three must be clean: `pnpm lint && pnpm typecheck && pnpm test`.
- Branch: `feat/mastery-ceiling-fix` (already exists, already holds the spec commit). Assert with `git branch --show-current` before every commit — this workspace has a known habit of flipping to `main`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/db/src/mastery/update.ts` | The mastery update rule. Gains two constants and a rewritten `prev === null` path. | 1 |
| `packages/db/src/mastery/update.test.ts` | Unit tests for the rule. Gains the seeding cases; one existing test is re-derived. | 1 |
| `packages/db/scripts/backfill-mastery.ts` | Rebuilds `user_grammar_mastery` from history. Gains old→new diff reporting in dry-run. | 2 |
| `infra/lambda/src/lib/debrief/skill-movements.test.ts` | Debrief banding tests. Gains the `ec7dd00f` end-to-end regression. | 3 |

**Known conflict:** Task 3 edits `skill-movements.test.ts`, which is also edited on the unmerged branch `fix/debrief-movement-confidence`. Both append tests to the same `describe('computeSkillMovements')` block. Whichever merges second will need a trivial conflict resolution — keep **both** test blocks; they assert different things (band vs. confidence cue).

---

### Task 1: Seed the first observation against a neutral prior

**Files:**
- Modify: `packages/db/src/mastery/update.ts:44` (constants), `:49-87` (`updateMastery`)
- Test: `packages/db/src/mastery/update.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no signature change. `updateMastery(prev: MasteryState | null, obs: MasteryObservation): MasteryState` and `replayHistory(rows: readonly HistoryRow[]): Map<string, MasteryState>` keep their exact existing shapes. Only returned *values* change, and only for a first observation.

- [ ] **Step 1: Write the failing tests**

Add to `packages/db/src/mastery/update.test.ts`, inside the existing `describe('updateMastery', …)` block:

```ts
  it('seeds a first observation against a neutral prior instead of taking it raw', () => {
    // Weighted average of NEUTRAL_PRIOR (0.5, weight PRIOR_PSEUDO_COUNT 0.5)
    // and the observation (weight = difficulty weight, B1 = 0.9, since
    // 1.0 >= 0.5 takes the reward branch):
    //   (0.5 * 0.5 + 0.9 * 1.0) / (0.5 + 0.9) = 1.15 / 1.4 = 0.8214...
    const next = updateMastery(null, { score: 1, difficulty: CefrLevel.B1, at: d('2026-01-01') });
    expect(next.masteryScore).toBeCloseTo(1.15 / 1.4, 5);
    expect(next.masteryScore).toBeLessThan(1); // the point of the change
  });

  it('leaves room to move in BOTH directions after a first observation', () => {
    const perfect = updateMastery(null, { score: 1, difficulty: CefrLevel.B1, at: d('2026-01-01') });
    const zero = updateMastery(null, { score: 0, difficulty: CefrLevel.B1, at: d('2026-01-01') });
    expect(perfect.masteryScore).toBeLessThan(1);
    expect(zero.masteryScore).toBeGreaterThan(0);
  });

  it('treats NEUTRAL_PRIOR as the fixed point of the seeding rule', () => {
    // A first observation of exactly 0.5 cannot move off the prior, at any
    // difficulty — the average of 0.5 and 0.5 is 0.5 for every weighting.
    for (const level of [CefrLevel.A1, CefrLevel.B1, CefrLevel.C2]) {
      const next = updateMastery(null, { score: 0.5, difficulty: level, at: d('2026-01-01') });
      expect(next.masteryScore).toBeCloseTo(0.5, 10);
    }
  });

  it('seeds a perfect first answer higher on a harder item', () => {
    const at = d('2026-01-01');
    const a1 = updateMastery(null, { score: 1, difficulty: CefrLevel.A1, at });
    const c2 = updateMastery(null, { score: 1, difficulty: CefrLevel.C2, at });
    expect(c2.masteryScore).toBeGreaterThan(a1.masteryScore);
    expect(a1.masteryScore).toBeCloseTo(0.75, 5);  // (0.25 + 0.5) / 1.0
    expect(c2.masteryScore).toBeCloseTo(0.875, 5); // (0.25 + 1.5) / 2.0
  });

  it('does not let the pseudo-count leak into evidence or confidence', () => {
    const next = updateMastery(null, { score: 1, difficulty: CefrLevel.B1, at: d('2026-01-01') });
    expect(next.evidenceCount).toBe(1);
    expect(next.confidence).toBeCloseTo(1 - Math.exp(-1 / 5), 10);
  });

  it('pulls a hinted first observation toward the neutral prior', () => {
    const at = d('2026-01-01');
    const full = updateMastery(null, { score: 1, difficulty: CefrLevel.B1, at });
    const hinted = updateMastery(null, { score: 1, difficulty: CefrLevel.B1, at, evidenceWeight: 0.1 });
    expect(hinted.masteryScore).toBeLessThan(full.masteryScore);
    expect(hinted.masteryScore).toBeGreaterThan(0.5);
  });
```

- [ ] **Step 2: Re-derive the one existing test that the change invalidates**

`'initializes from the first observation'` asserts the raw score survives. That is exactly the behavior being removed, so the assertion must be re-derived from the new rule — **not** replaced with the observed output.

For a first score of `0.8` at B1: `0.8 >= NEUTRAL_PRIOR`, so the reward branch applies with `dw = 0.9`, giving `(0.5 * 0.5 + 0.9 * 0.8) / (0.5 + 0.9) = 0.97 / 1.4`. Replace lines 8-14 with:

```ts
  it('initializes from the first observation, shrunk toward the neutral prior', () => {
    const next = updateMastery(null, { score: 0.8, difficulty: CefrLevel.B1, at: d('2026-01-01') });
    expect(next.masteryScore).toBeCloseTo(0.97 / 1.4, 5); // ≈ 0.6929
    expect(next.evidenceCount).toBe(1);
    expect(next.confidence).toBeCloseTo(1 - Math.exp(-1 / 5), 5);
    expect(next.lastPracticedAt).toEqual(d('2026-01-01'));
  });
```

This is the **only** existing test in either suite that changes — verified by applying the change and running both suites. Every other case folding from a fresh point is written as a relative comparison, so a shifted seed moves both sides equally. If any *other* test fails in Step 4, stop: that is a real regression, not expected churn.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm --filter @language-drill/db exec vitest run src/mastery/update.test.ts
```

Expected: the new seeding tests FAIL (e.g. `expected 1 to be close to 0.8214…`), and the re-derived `initializes from…` test FAILS (`expected 0.8 to be close to 0.6929`).

- [ ] **Step 4: Implement the change**

In `packages/db/src/mastery/update.ts`, add beside the existing constants (after `K_EVIDENCE`, line 44):

```ts
// A first observation is folded against a weak virtual prior rather than taken
// raw, so one lucky (or unlucky) answer cannot pin a point at 1.0 / 0.0 and
// leave the model nowhere to move but back. The pseudo-count is a WEIGHT, not
// evidence — it never reaches `evidenceCount` or `confidence`.
const NEUTRAL_PRIOR = 0.5;
const PRIOR_PSEUDO_COUNT = 0.5;
```

Then rewrite the body of `updateMastery`. Replace the `prev === null` early return and every subsequent `prev.` reference in the math with `base.`:

```ts
export function updateMastery(
  prev: MasteryState | null,
  obs: MasteryObservation,
): MasteryState {
  const dw = DIFFICULTY_WEIGHTS[obs.difficulty];

  // `lastPracticedAt: obs.at` ⇒ days = 0 ⇒ decay = 1, so the virtual prior
  // enters at its full (already small) weight.
  const base: MasteryState = prev ?? {
    masteryScore: NEUTRAL_PRIOR,
    confidence: 0,
    evidenceCount: PRIOR_PSEUDO_COUNT,
    lastPracticedAt: obs.at,
  };

  const days = Math.max(
    0,
    (obs.at.getTime() - base.lastPracticedAt.getTime()) / MS_PER_DAY,
  );
  const decay = Math.exp(-days / HALFLIFE_DAYS);
  const priorW = PRIOR_BASE * base.evidenceCount * decay;

  // Asymmetric observation weight: gains scale with difficulty (reward hard
  // correct), losses scale with INVERSE difficulty (punish easy errors).
  const ew = obs.evidenceWeight == null ? 1 : clamp01(obs.evidenceWeight);
  const obsW = (obs.score >= base.masteryScore ? dw : DW_PIVOT - dw) * ew;

  const masteryScore = clamp01(
    (priorW * base.masteryScore + obsW * obs.score) / (priorW + obsW),
  );
  const evidenceCount = (prev?.evidenceCount ?? 0) + 1;

  return {
    masteryScore,
    confidence: confidenceFor(evidenceCount),
    evidenceCount,
    lastPracticedAt: obs.at,
  };
}
```

Note the two easy-to-miss details: `evidenceCount` reads from `prev`, **not** `base` (that is what keeps the pseudo-count out of evidence), and `clamp01` stays — `obs.score` is unvalidated at the call site.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @language-drill/db exec vitest run src/mastery/update.test.ts
```

Expected: PASS, 15 tests. If a test other than `initializes from the first observation` fails, stop and investigate — see Step 2.

- [ ] **Step 6: Rebuild `db` and confirm the lambda suite is unaffected**

```bash
pnpm --filter @language-drill/db build
pnpm --filter @language-drill/lambda exec vitest run src/lib/debrief/skill-movements.test.ts
```

Expected: PASS, 11 tests, none modified. (The rebuild is mandatory — lambda resolves `@language-drill/db` through `dist`.)

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # must be feat/mastery-ceiling-fix
git add packages/db/src/mastery/update.ts packages/db/src/mastery/update.test.ts
git commit -m "fix(mastery): seed a first observation against a weak neutral prior

updateMastery took a first-ever observation's raw score as the mastery
estimate, so one perfect answer pinned a point at 1.0 and every later
observation could only drag it down. 86 of 137 tracked (user, point)
pairs in prod sit on that ceiling.

Fold the first observation against a virtual prior (0.5, pseudo-count
0.5) through the existing averaging step, so there is no new branch in
the math and the seed inherits the model's difficulty asymmetry: a
perfect first answer now seeds 0.750 at A1 and 0.875 at C2.

evidenceCount still counts real observations only, so confidence after
one row is unchanged at confidenceFor(1)."
```

---

### Task 2: Report an old→new diff in the backfill dry-run

**Files:**
- Modify: `packages/db/scripts/backfill-mastery.ts:10` (imports), `:78-118` (the upsert loop and final report)

**Interfaces:**
- Consumes: `replayHistory` from Task 1 (unchanged signature; changed values).
- Produces: no exported symbols — this is a CLI script. Its new stdout contract is the review gate for the production rollout: a `moved / mean / max` summary line, a top-20 largest-shift table, and a weakest-20 before-vs-after comparison.

**Why this task exists:** the spec's rollout gates `--apply` behind reviewing the old→new diff, but the script currently prints only `[dry-run] Would write N mastery rows …`. It never reads existing `user_grammar_mastery` values, so the gate is unenforceable without this change.

- [ ] **Step 1: Add the existing-values read**

The script already imports `userGrammarMastery` (line 10). After the `rows` query and before the `byUserLang` grouping loop, add:

```ts
  // Existing stored mastery, for the old→new diff. Keyed the same way the
  // upsert's conflict target is: (userId, grammarPointKey).
  const existingRows = await db
    .select({
      userId: userGrammarMastery.userId,
      grammarPointKey: userGrammarMastery.grammarPointKey,
      masteryScore: userGrammarMastery.masteryScore,
    })
    .from(userGrammarMastery);

  const existingByKey = new Map<string, number>();
  for (const r of existingRows) {
    if (r.userId && r.grammarPointKey && r.masteryScore != null) {
      existingByKey.set(`${r.userId} ${r.grammarPointKey}`, r.masteryScore);
    }
  }
```

- [ ] **Step 2: Collect per-point deltas inside the upsert loop**

Declare beside `let upserts = 0;`:

```ts
  type Shift = { userId: string; grammarPointKey: string; from: number | null; to: number };
  const shifts: Shift[] = [];
```

Inside the `for (const [grammarPointKey, s] of finalStates)` loop, immediately after `upserts += 1;`:

```ts
      const priorScore = existingByKey.get(`${userId} ${grammarPointKey}`) ?? null;
      shifts.push({ userId: userId!, grammarPointKey, from: priorScore, to: s.masteryScore });
```

- [ ] **Step 3: Report the diff**

Replace the single closing `console.log(...)` with:

```ts
  const changed = shifts.filter(
    (s) => s.from !== null && Math.abs(s.to - s.from) > 1e-6,
  ) as Array<Shift & { from: number }>;
  const absDelta = (s: { from: number; to: number }) => Math.abs(s.to - s.from);
  const mean =
    changed.length === 0
      ? 0
      : changed.reduce((acc, s) => acc + absDelta(s), 0) / changed.length;
  const max = changed.reduce((acc, s) => Math.max(acc, absDelta(s)), 0);
  const brandNew = shifts.filter((s) => s.from === null).length;

  console.log(
    `${apply ? 'Wrote' : '[dry-run] Would write'} ${upserts} mastery rows ` +
      `across ${byUserLang.size} (user,language) groups from ${rows.length} history rows.`,
  );
  console.log(
    `Diff: ${changed.length} moved, ${brandNew} new, ` +
      `mean |Δ| ${mean.toFixed(4)}, max |Δ| ${max.toFixed(4)}.`,
  );

  const fmt = (s: Shift) =>
    `  ${s.grammarPointKey.padEnd(38)} ${(s.from ?? 0).toFixed(3)} → ${s.to.toFixed(3)}` +
    `  (${s.from === null ? 'new' : (s.to - s.from >= 0 ? '+' : '') + (s.to - s.from).toFixed(3)})`;

  console.log('\nTop 20 largest shifts:');
  for (const s of [...changed].sort((a, b) => absDelta(b) - absDelta(a)).slice(0, 20)) {
    console.log(fmt(s));
  }

  // Selection ranks weakest-first, so this is the list that actually decides
  // what gets served next. Compare the two orderings, not just the values.
  console.log('\nWeakest 20 BEFORE:');
  for (const s of changed.slice().sort((a, b) => a.from - b.from).slice(0, 20)) {
    console.log(fmt(s));
  }
  console.log('\nWeakest 20 AFTER:');
  for (const s of changed.slice().sort((a, b) => a.to - b.to).slice(0, 20)) {
    console.log(fmt(s));
  }
```

- [ ] **Step 4: Verify the script still typechecks and runs**

```bash
pnpm --filter @language-drill/db typecheck
```

Expected: PASS.

Then dry-run it against the **local dev** database (`.env`'s `DATABASE_URL` is the Neon *dev* branch — never production at this step):

```bash
pnpm backfill:mastery
```

Expected: the original `[dry-run] Would write N mastery rows …` line, followed by the `Diff:` summary and the three tables. Confirm no rows were written:

```bash
pnpm backfill:mastery   # run twice; the Diff line must be identical both times
```

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must be feat/mastery-ceiling-fix
git add packages/db/scripts/backfill-mastery.ts
git commit -m "feat(backfill): report an old→new mastery diff in the dry-run

The dry-run printed only a row count, so the rollout's 'review the diff
before --apply' gate had nothing to review. Read the existing
user_grammar_mastery values, then report how many points move, the mean
and max absolute shift, the top-20 largest shifts, and the weakest-20
ordering before vs after — the last of these being what selection
actually ranks on."
```

---

### Task 3: Regression-test the observed production failure

**Files:**
- Modify: `infra/lambda/src/lib/debrief/skill-movements.test.ts` (append one test to the existing `describe('computeSkillMovements', …)` block)

**Interfaces:**
- Consumes: `computeSkillMovements({ rows, sessionRowIds, labels })` and `type SkillHistoryRow` from `./skill-movements.js`, plus the Task 1 seeding behavior via `replayHistory`. All already imported at the top of the file.
- Produces: nothing consumed by later tasks.

**Note:** see the "Known conflict" entry in File Structure — `fix/debrief-movement-confidence` also appends to this block.

- [ ] **Step 1: Write the test**

Append inside `describe('computeSkillMovements', …)`, after the `evidenceWeight` test:

```ts
  it('does not band a flawless session as a slip against a single-observation prior', () => {
    // The real rows from production session ec7dd00f-8c41-4d0e-ad5e-d7aa4b45ebc1
    // (es-b1-impersonal-plural). Every session answer is at or above
    // CORRECT_THRESHOLD (0.7), so the debrief header read "5 of 5 · 100%".
    // Before the neutral-prior seeding, the lone 1.0 prior pinned mastery at
    // 1.000 and this replayed to 0.927 — banding a perfect session 'slip'.
    const rows: SkillHistoryRow[] = [
      { id: 'p1', grammarPointKey: 'gp-a', score: 1,    difficulty: CefrLevel.B1, evaluatedAt: at('2026-07-29T22:29:17.763Z') },
      { id: 's1', grammarPointKey: 'gp-a', score: 0.82, difficulty: CefrLevel.B1, evaluatedAt: at('2026-08-08T17:57:51.737Z') },
      { id: 's2', grammarPointKey: 'gp-a', score: 0.92, difficulty: CefrLevel.B1, evaluatedAt: at('2026-08-08T18:00:09.790Z') },
      { id: 's3', grammarPointKey: 'gp-a', score: 1,    difficulty: CefrLevel.B1, evaluatedAt: at('2026-08-08T18:03:37.818Z') },
      { id: 's4', grammarPointKey: 'gp-a', score: 0.88, difficulty: CefrLevel.B1, evaluatedAt: at('2026-08-08T18:05:29.227Z') },
      { id: 's5', grammarPointKey: 'gp-a', score: 1,    difficulty: CefrLevel.B1, evaluatedAt: at('2026-08-08T18:06:11.554Z') },
    ];
    const out = computeSkillMovements({
      rows,
      sessionRowIds: new Set(['s1', 's2', 's3', 's4', 's5']),
      labels: new Map([['gp-a', 'Point A']]),
    });
    expect(out[0].band).not.toBe('slip');
    expect(out[0].band).toBe('strong-gain'); // 0.8214 → 0.9021, Δ +0.0807
  });
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
pnpm --filter @language-drill/db build
pnpm --filter @language-drill/lambda exec vitest run src/lib/debrief/skill-movements.test.ts
```

Expected: PASS, 12 tests.

This test passes on the first run because Task 1 already fixed the behavior — that is intended. To confirm it is genuinely discriminating rather than vacuous, temporarily revert `updateMastery`'s `base` back to the old `prev === null` early return, re-run, and observe this test fail with `expected 'slip' not to be 'slip'`. Then restore the fix.

- [ ] **Step 3: Commit**

```bash
git branch --show-current   # must be feat/mastery-ceiling-fix
git add infra/lambda/src/lib/debrief/skill-movements.test.ts
git commit -m "test(debrief): pin the ec7dd00f flawless-session regression

Replays the six real history rows from the production session that
banded a 5-of-5 result as 'slipped'. Under the neutral-prior seeding it
bands strong-gain instead."
```

---

### Task 4: Full gate, then the production rollout

**Files:** none modified — this task is verification and operations.

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: a reviewed production `user_grammar_mastery` rebuild.

- [ ] **Step 1: Run the full pre-push gate**

```bash
rm -rf infra/lambda/dist   # stale compiled *.test.js cause phantom failures
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all three clean, zero failures. Do not proceed on any failure.

- [ ] **Step 2: Push and open the PR**

```bash
git branch --show-current   # must be feat/mastery-ceiling-fix
git push -u origin feat/mastery-ceiling-fix
```

Open a PR describing the ceiling problem, the 86/137 production figure, and the seed table. **Stop here for human review** — the remaining steps touch production data.

- [ ] **Step 3: Merge and deploy**

Squash-merge (project default), editing the squash message down to the PR summary rather than the auto-generated bullet list. Merging triggers the deploy pipeline; wait for the CDK deploy to finish so the Lambda runs the new rule before any backfill.

- [ ] **Step 4: Dry-run the backfill against production and review**

Production is **not** the `.env` database (that is the Neon dev branch). Fetch the production string from AWS Secrets Manager (`aws --region eu-central-1 secretsmanager get-secret-value --secret-id language-drill/DATABASE_URL --query SecretString --output text`), or from the Neon console — project `twilight-smoke-01114337`, branch `br-green-waterfall-ancrvpr5`. Supply it explicitly and never commit it:

```bash
DATABASE_URL='<production Neon connection string>' \
  pnpm --filter @language-drill/db backfill:mastery | tee /tmp/mastery-diff.txt
```

Review before applying:
- `Diff:` line — expect roughly 137 rows in scope and a large `moved` count.
- Top-20 shifts — the biggest movers should be points with **few** history rows. A large shift on a heavily-evidenced point means something is wrong; stop and investigate.
- **Weakest-20 before vs after** — this is the decision. It is what selection ranks on, so it determines what gets served next. If the two lists are broadly similar, apply. If the ordering is unrecognizable, stop and take it back to the spec author — the response is a design decision, not an improvisation.

- [ ] **Step 5: Apply**

Only after Step 4's review passes:

```bash
DATABASE_URL='<production Neon connection string>' \
  pnpm --filter @language-drill/db backfill:mastery --apply
```

The script is idempotent and reads only `user_exercise_history`, which this change never touches — so it can be re-run safely, and re-running after a future rule change is the supported recovery path.

- [ ] **Step 6: Verify in the product**

Open a debrief for a recent session and confirm no flawless session reports a slip. Spot-check `/progress` — thin points should have moved off the 1.0 ceiling, which is the intended (and more honest) outcome.

---

## Notes for the implementer

- **Do not "fix" the seed values to rounder numbers.** They are the output of the existing asymmetric weighting, and their difficulty-dependence (0.750 at A1 → 0.875 at C2 for a perfect answer) is a deliberate property, not an artifact.
- **The one broken test is expected; a second broken test is not.** See Task 1, Step 2.
- **The confidence cue is a separate concern.** Branch `fix/debrief-movement-confidence` gates the debrief's confidence badge on `min(before, after)`. It is complementary and independently mergeable — do not fold it in here.
