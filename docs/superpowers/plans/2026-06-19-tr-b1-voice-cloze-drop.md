# Drop Cloze for TR B1 Voice + Periphrastic Points — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop generating and serving ambiguous Turkish B1 cloze exercises for four voice points and obligation-periphrases by marking them `clozeUnsuitable`, then demote the existing pool rows.

**Architecture:** Pure curriculum-data change in `@language-drill/db` — set an existing `clozeUnsuitable: true` flag on five grammar points (the cell-builder already drops the cloze cell for such points), bump `CURRICULUM_VERSION_TR`, update one exhaustive test. Plus a one-off, gated prod SQL cleanup of already-generated rows.

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Vitest. Neon (prod branch `br-green-waterfall-ancrvpr5`, project `twilight-smoke-01114337`) for the pool cleanup.

## Global Constraints

- **Five points only:** `tr-b1-causative-voice`, `tr-b1-passive-voice`, `tr-b1-reflexive-voice-kendi`, `tr-b1-reciprocal-voice`, `tr-b1-obligation-periphrases`. No other points, no other languages.
- **Use the existing `clozeUnsuitable: true` flag** (`packages/shared/src/curriculum-types.ts:88`); do NOT add new cell-builder logic — `compatibleTypes()` already handles it.
- **Bump `CURRICULUM_VERSION_TR`** from `'2026-06-19'` to `'2026-06-19a'` (test regex `^\d{4}-\d{2}-\d{2}[a-z]?$` permits a same-day trailing letter).
- **Exhaustive set test must be updated** from nine to fourteen TR points (the existing nine plus the five new keys). The set comparison sorts both sides, so order is irrelevant.
- **Invariant:** all five points are `kind: 'grammar'` (satisfies the `clozeUnsuitable ⇒ kind==='grammar'` invariant).
- **Pool cleanup runs AFTER the curriculum change is merged + deployed**, demotes to `review_status='rejected'`, and is gated on explicit human confirmation (prod mutation). Dry-run SELECT first.

**Reference spec:** `docs/superpowers/specs/2026-06-19-tr-b1-voice-cloze-drop-design.md`

---

## Task 0: Branch + commit the spec/plan

**Files:** none (git only)

- [ ] **Step 1: Create the feature branch from main**

```bash
cd /Users/seal/dev/language-drill
git switch -c feat/tr-b1-voice-cloze-drop main
git rev-parse --abbrev-ref HEAD   # must print feat/tr-b1-voice-cloze-drop
```

- [ ] **Step 2: Commit the spec + plan (explicit paths only — never `git add -A`)**

```bash
git add docs/superpowers/specs/2026-06-19-tr-b1-voice-cloze-drop-design.md \
        docs/superpowers/plans/2026-06-19-tr-b1-voice-cloze-drop.md
git commit -m "docs: spec + plan for dropping TR B1 voice/periphrastic cloze

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1: Mark the five points `clozeUnsuitable` + bump curriculum version + update tests

**Files:**
- Modify: `packages/db/src/curriculum/tr.ts` — five grammar-point objects (`tr-b1-obligation-periphrases` @1293, `tr-b1-causative-voice` @1327, `tr-b1-passive-voice` @1360, `tr-b1-reflexive-voice-kendi` @1387, `tr-b1-reciprocal-voice` @1414) and `CURRICULUM_VERSION_TR` @53.
- Modify (test): `packages/db/src/curriculum/curriculum.test.ts` — the exhaustive set test (~line 264).

**Interfaces:**
- Consumes: the existing `clozeUnsuitable?: boolean` field and `compatibleTypes()` cell logic (no signature changes).
- Produces: no new exports. After this task, `enumerateCurriculumCells` emits no `CLOZE` cell for the five points.

- [ ] **Step 1: Update the exhaustive-set test first (TDD — it should fail until the curriculum is changed)**

In `packages/db/src/curriculum/curriculum.test.ts`, find the test `'the full TR clozeUnsuitable set is exactly these nine points'` (~line 264). Rename it to `'... these fourteen points'` and add the five new keys to the expected array. The full expected array becomes (the comparison sorts, so order is cosmetic):

```ts
  it('the full TR clozeUnsuitable set is exactly these fourteen points', () => {
    const flagged = trCurriculum
      .filter((g) => g.clozeUnsuitable === true)
      .map((g) => g.key)
      .sort();
    expect(flagged).toEqual(
      [
        'tr-a1-beri-dir',
        'tr-a1-gore-bence',
        'tr-a2-converbs',
        'tr-a2-correlative-conjunctions',
        'tr-a2-nominalization',
        'tr-a2-relative-an',
        'tr-b1-converb-while-yken',
        'tr-b1-participles-dik-acak',
        'tr-b1-since-converb',
        'tr-b1-causative-voice',
        'tr-b1-obligation-periphrases',
        'tr-b1-passive-voice',
        'tr-b1-reciprocal-voice',
        'tr-b1-reflexive-voice-kendi',
      ].sort(),
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @language-drill/db test -- curriculum.test.ts
```
Expected: FAIL — the `toEqual` set comparison shows the five new keys missing from `flagged` (the curriculum hasn't been changed yet).

- [ ] **Step 3: Add `clozeUnsuitable: true` to the five grammar points**

In `packages/db/src/curriculum/tr.ts`, add the line `clozeUnsuitable: true,` to each of the five objects, alongside their existing suitability flags. Place it consistently with how other points in the file order the flag (next to the other `*Suitable` flags). The five objects start at:
- `tr-b1-obligation-periphrases` (line ~1293; already has `conjugationSuitable: true`)
- `tr-b1-causative-voice` (line ~1327; already has `conjugationSuitable: true`, `sentenceConstructionSuitable: true`)
- `tr-b1-passive-voice` (line ~1360; already has `sentenceConstructionSuitable: true`)
- `tr-b1-reflexive-voice-kendi` (line ~1387; already has `sentenceConstructionSuitable: true`)
- `tr-b1-reciprocal-voice` (line ~1414; already has `sentenceConstructionSuitable: true`)

Add a brief inline comment on one of them referencing why (Turkish voice/periphrasis is agglutinative → single-blank cloze conflates the target morpheme with free tense/polarity/person → flagged `ambiguous`; see the 2026-06-19 run analysis). Example for the causative entry:

```ts
    key: 'tr-b1-causative-voice',
    // clozeUnsuitable: a single whole-word blank conflates the causative
    // morpheme with free tense/polarity/person the carrier can't constrain →
    // validator flags `ambiguous` (2026-06-19 run, 12% approval). Keeps
    // translation + sentence_construction + conjugation. See
    // docs/analysis/generation-run-2026-06-19.md.
    clozeUnsuitable: true,
    conjugationSuitable: true,
    sentenceConstructionSuitable: true,
```

- [ ] **Step 4: Bump `CURRICULUM_VERSION_TR`**

`packages/db/src/curriculum/tr.ts:53`:

```ts
export const CURRICULUM_VERSION_TR = '2026-06-19a';
```

- [ ] **Step 5: Run the focused tests to verify they pass**

```bash
pnpm --filter @language-drill/db test -- curriculum.test.ts cells.test.ts
```
Expected: PASS. Specifically:
- the fourteen-point set test passes;
- the `cells.test.ts` count test (which derives the `clozeUnsuitable` count dynamically from `ALL_CURRICULA`) still passes — it self-adjusts;
- the `CURRICULUM_VERSION_TR` format test (`/^\d{4}-\d{2}-\d{2}[a-z]?$/`) passes with the `a` suffix.

If any OTHER test hardcodes a TR cell count, a cloze count, or the prior `CURRICULUM_VERSION_TR` value, update it to match and note it in the report.

- [ ] **Step 6: Run the full db package suite**

```bash
pnpm --filter @language-drill/db test
```
Expected: all pass. (If a stale-dist error appears, run `pnpm build` from the repo root first, then re-run.)

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # confirm feat/tr-b1-voice-cloze-drop
git add packages/db/src/curriculum/tr.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "fix(curriculum): mark TR B1 voice + obligation cloze-unsuitable

Single whole-word cloze conflates the voice/obligation morpheme with free
tense/polarity/person → validator flags ambiguous (12-54% approval on the
2026-06-19 run vs 68-80% for translation/SC). Drop cloze for these five
points; they keep translation + SC/conjugation. Bumps CURRICULUM_VERSION_TR.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Full pre-push gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite from the repo root**

```bash
cd /Users/seal/dev/language-drill
pnpm lint && pnpm typecheck && pnpm test
```
Expected: zero failures across all packages. (If a stale `infra/lambda/dist` or `db/dist` causes phantom failures, `rm -rf infra/lambda/dist` and/or `pnpm build`, then re-run — per project memories.)

---

## Task 3: Open the PR

**Files:** none (process)

- [ ] **Step 1: Confirm gh account, push, open PR**

```bash
gh auth status   # active account MUST be nikolaivanv
git push -u origin feat/tr-b1-voice-cloze-drop
gh pr create --base main --head feat/tr-b1-voice-cloze-drop \
  --title "fix(curriculum): drop cloze for TR B1 voice + obligation points" \
  --body "$(cat <<'EOF'
## Why

On the 2026-06-19 run, TR B1 voice cloze (causative/passive/reflexive/reciprocal) and obligation-periphrases cloze had the worst approval of the B1 launch (12–54%), dominated by `ambiguous` flags. A single whole-word Turkish cloze blank conflates the target voice/obligation morpheme with free tense/polarity/person the carrier sentence can't constrain. The same points clear 68–80% as translation and sentence-construction — cloze is the wrong surface for productive agglutinative voice morphology.

## What

Set `clozeUnsuitable: true` on five TR B1 points (`compatibleTypes()` already drops the cloze cell — no new logic):
- causative → keeps translation + SC + conjugation
- passive, reflexive-kendi, reciprocal → keep translation + SC
- obligation-periphrases → keeps translation + conjugation

Bumps `CURRICULUM_VERSION_TR` → `2026-06-19a` (re-resolves cells, clears low-yield suppression). Updates the exhaustive `clozeUnsuitable` set test (9 → 14).

## Follow-up (post-merge, gated)

Demote already-generated cloze for these five points on prod (`UPDATE exercises SET review_status='rejected' ...`) — runs AFTER deploy so the scheduler doesn't regenerate them. See the spec.

Spec: `docs/superpowers/specs/2026-06-19-tr-b1-voice-cloze-drop-design.md`
Analysis: `docs/analysis/generation-run-2026-06-19.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Task 4: Post-merge prod pool cleanup (GATED — do not run autonomously)

**Files:** none (one-off prod data operation via Neon MCP `run_sql`)

> Run only AFTER the PR is merged and deployed (CDK + the scheduler picking up the new curriculum), and only with explicit human confirmation. Project `twilight-smoke-01114337`, branch `br-green-waterfall-ancrvpr5`.

- [ ] **Step 1: Dry-run — count what would be demoted**

```sql
SELECT grammar_point_key, review_status, count(*)
FROM exercises
WHERE language='TR' AND type='cloze'
  AND grammar_point_key IN (
    'tr-b1-causative-voice','tr-b1-passive-voice','tr-b1-reflexive-voice-kendi',
    'tr-b1-reciprocal-voice','tr-b1-obligation-periphrases')
  AND review_status IN ('auto-approved','manual-approved','flagged')
GROUP BY 1,2 ORDER BY 1,2;
```
Report the counts and get explicit confirmation before proceeding.

- [ ] **Step 2: Apply the demotion (after confirmation)**

```sql
UPDATE exercises SET review_status='rejected'
WHERE language='TR' AND type='cloze'
  AND grammar_point_key IN (
    'tr-b1-causative-voice','tr-b1-passive-voice','tr-b1-reflexive-voice-kendi',
    'tr-b1-reciprocal-voice','tr-b1-obligation-periphrases')
  AND review_status IN ('auto-approved','manual-approved','flagged');
```

- [ ] **Step 3: Verify**

Re-run the Step 1 SELECT — expect zero rows in the served/flagged statuses for these five points. Confirm on the next ~04:00 UTC run that no new `tr:b1:cloze:` jobs appear for them.

---

## Self-Review

**Spec coverage:**
- `clozeUnsuitable` on five points + version bump → Task 1 ✅
- Exhaustive set test 9 → 14 → Task 1 Step 1 ✅
- Dynamic cell-count test self-adjusts (verified) → Task 1 Step 5 ✅
- Full gate → Task 2 ✅
- Prod pool cleanup, gated, after deploy, demote to `rejected` → Task 4 ✅
- PR → Task 3 ✅

**Placeholder scan:** none. The only conditional ("if any OTHER test hardcodes a TR cell/cloze count") is an explicit verification instruction with the action spelled out, not a vague TODO.

**Type consistency:** the five grammar-point keys are identical across Task 1, Task 3 (PR body), and Task 4 (SQL). `CURRICULUM_VERSION_TR = '2026-06-19a'` is consistent between Task 1 Step 4 and the Global Constraints. Demotion target `review_status='rejected'` is consistent between spec and Task 4.
