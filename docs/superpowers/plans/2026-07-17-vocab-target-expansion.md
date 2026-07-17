# Curated Vocab-Target Expansion (All Levels + DE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every ES/TR/DE × A1–B2 scope has a themed vocab-umbrella set in the curriculum and an approved curated `vocab_target` pool, so the nightly scheduler converges `vocab_recall` coverage onto the targets.

**Architecture:** Three tracks. Track A (immediate, prod-data-only): curate the scopes whose umbrellas already exist — ES A2, TR A2, TR B1 — plus a DE `vocab_recall` dedupe sweep. Track B (curriculum PR): add the 30 missing themed umbrellas + test-floor and version bumps. Track C (post-merge, prod-data-only): curate DE A1–B2, ES B1/B2, TR B2, then verify convergence.

**Tech Stack:** existing CLIs (`generate:vocab-targets`, `review:flagged-vocab`), Drizzle/Neon (prod branch), Vitest, plain SQL via psql.

**Spec:** `docs/superpowers/specs/2026-07-17-vocab-target-expansion-design.md`

## Global Constraints

- **Prod DB:** data tasks run against the **production** Neon branch. Pull the URL each session: `PROD_DB=$(aws --region eu-central-1 secretsmanager get-secret-value --secret-id language-drill/DATABASE_URL --query SecretString --output text)`. Never export it into `.env`. Local `.env` `DATABASE_URL` is the **dev** branch — never run authoring against it (wasted spend, wrong data).
- **API key:** `AK=$(grep '^ANTHROPIC_API_KEY=' /Users/seal/dev/language-drill/.env | cut -d= -f2-)`.
- **Don't double-author an umbrella.** `generate:vocab-targets` always proposes ~30 *new* words per umbrella in scope (avoid-list prevents dupes but not re-sizing). Run each `(language, level)` scope **exactly once**, and only when its full umbrella set exists. This is why DE A2/B1/B2 and ES B1/B2 wait for Track C (their broad umbrellas would otherwise get 60 words vs 30 for siblings).
- **`--approve-all` is language-wide** (all flagged rows for the language, no level filter). Only run it when every flagged row for that language has been triaged and user-approved.
- **User gates:** per-language spot-check before any `--approve-all`; PR review before merge. Do not skip.
- **Curriculum edits** happen in a worktree under `.claude/worktrees/vocab-umbrella-expansion/` (never repo root; never `.claire/`). Assert `git branch --show-current` before every commit. Use absolute paths prefixed with the worktree root for every Edit/Write.
- **Umbrella entry shape** (matches existing entries exactly): `kind: 'vocab'`, key `<lang>-<level>-vocab-<theme>`, `name` ending in `(<LEVEL>)`, description ≤450 chars, `examplesPositive` (2, target-language), `examplesNegative` (1, `*`-prefixed), `commonErrors` (2, each naming a concrete confusion with quoted forms). No theory-categories entry (theory is grammar-only). No `clozeUnsuitable`/`sentenceConstructionSuitable`/`conjugationSuitable` flags (curriculum tests reject them on vocab).
- **coverageSpec policy:** none by default; `wordClass` floors only for food-drink-style umbrellas (precedent `tr-a1-vocab-food-drink`: `{ noun: 6, verb: 2, adjective: 2 }`, floors sum to the vocab target 10). Record the decision as a code comment per the checklist in `docs/curriculum-authoring.md`.
- **Pre-push gates** for the PR: `pnpm lint && pnpm typecheck && pnpm test` from repo root, zero failures. Before the full suite: `rm -rf infra/lambda/dist` (stale-dist phantom failures) and `pnpm build` (stale `db/dist`). Squash-merge with an edited summary message.

---

## Track A — immediate data curation (no repo changes)

### Task 1: Prod pre-flight

**Files:** none (read-only SQL + a short report back to the orchestrator).

**Interfaces:**
- Produces: go/no-go on DE frequency bands; baseline `vocab_target` counts used by Tasks 3–5.

- [ ] **Step 1: Pull the prod URL and check `vocab_lemma` coverage per language**

```bash
PROD_DB=$(aws --region eu-central-1 secretsmanager get-secret-value --secret-id language-drill/DATABASE_URL --query SecretString --output text)
psql "$PROD_DB" -c "SELECT language, COUNT(*) AS lemmas,
  COUNT(*) FILTER (WHERE 'VERB' = ANY(pos_all)) AS verbs,
  COUNT(*) FILTER (WHERE 'NOUN' = ANY(pos_all)) AS nouns
  FROM vocab_lemma GROUP BY 1 ORDER BY 1;"
```

Expected: ES/TR/DE rows each with thousands of lemmas and non-trivial verb/noun counts (total ~88k). **Blocker rule:** if DE has < ~5,000 lemmas or near-zero nouns, STOP — report to the user before any DE work (Task 2 can still proceed; Track C DE runs cannot).

- [ ] **Step 2: Baseline `vocab_target` state**

```bash
psql "$PROD_DB" -c "SELECT language, cefr_level, status, COUNT(*)
  FROM vocab_target GROUP BY 1,2,3 ORDER BY 1,2,3;"
```

Expected: only ES A1 (~131 approved) and TR A1 (~143 approved); zero `flagged` rows anywhere. If flagged rows exist, STOP and report (a later `--approve-all` would sweep them in unreviewed).

- [ ] **Step 3: Reference convergence check (ES A1 / TR A1)**

```bash
psql "$PROD_DB" -c "SELECT e.language, e.grammar_point_key, COUNT(DISTINCT lower(trim(e.content_json->>'expectedWord'))) AS covered
  FROM exercises e WHERE e.type='vocab_recall'
  AND e.review_status IN ('auto-approved','manual-approved')
  AND e.grammar_point_key LIKE '%-a1-vocab-%'
  GROUP BY 1,2 ORDER BY 1,2;"
```

Expected: each A1 umbrella covering ≈ its approved-target count. Record the numbers in the report (they're the "converged" reference for Task 13).

### Task 2: DE `vocab_recall` dedupe sweep

PR #563 demoted legacy duplicate `vocab_recall` cards for TR + ES only. DE's free-gen pool (live since 2026-07-12) needs the same one-canonical-per-word-per-umbrella demotion, otherwise Track C's seeded generation stacks onto duplicates and the coverage read model overcounts.

**Files:** none (SQL only; keeps parity with how #563 did it).

**Interfaces:**
- Produces: DE pool with ≤1 approved `vocab_recall` per `(grammar_point_key, normalized expectedWord)`.

- [ ] **Step 1: Dry-run count**

Keep the **newest** duplicate (later cards come from the fixed #574/#575 prompts), demote the rest. Normalization approximates `normalizeWord` (trim+lower; expectedWord values are bare words, no articles — verify in the sample output):

```bash
psql "$PROD_DB" -c "WITH ranked AS (
  SELECT id, grammar_point_key, content_json->>'expectedWord' AS w,
    ROW_NUMBER() OVER (
      PARTITION BY grammar_point_key, lower(trim(content_json->>'expectedWord'))
      ORDER BY created_at DESC) AS rn
  FROM exercises
  WHERE type='vocab_recall' AND language='DE'
    AND review_status IN ('auto-approved','manual-approved')
    AND content_json ? 'expectedWord')
SELECT COUNT(*) AS to_demote FROM ranked WHERE rn > 1;"
psql "$PROD_DB" -c "WITH ranked AS (
  SELECT id, grammar_point_key, content_json->>'expectedWord' AS w,
    ROW_NUMBER() OVER (
      PARTITION BY grammar_point_key, lower(trim(content_json->>'expectedWord'))
      ORDER BY created_at DESC) AS rn
  FROM exercises
  WHERE type='vocab_recall' AND language='DE'
    AND review_status IN ('auto-approved','manual-approved')
    AND content_json ? 'expectedWord')
SELECT grammar_point_key, w, rn FROM ranked WHERE rn > 1 ORDER BY 1,2 LIMIT 20;"
```

Expected: a plausible count (tens, not thousands) and sample rows that are genuine duplicates. If expectedWord values carry leading articles ("das Haus" vs "Haus" counted separately), extend the partition expression to strip them before applying.

- [ ] **Step 2: Apply the demotion**

```bash
psql "$PROD_DB" -c "WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
      PARTITION BY grammar_point_key, lower(trim(content_json->>'expectedWord'))
      ORDER BY created_at DESC) AS rn
  FROM exercises
  WHERE type='vocab_recall' AND language='DE'
    AND review_status IN ('auto-approved','manual-approved')
    AND content_json ? 'expectedWord')
UPDATE exercises SET review_status='flagged'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);"
```

Expected: `UPDATE <same count as dry-run>`.

- [ ] **Step 3: Verify zero remaining duplicates** — re-run the Step 1 count query; expected `to_demote = 0`. Report the demoted count.

### Task 3: Author ES A2 (5 umbrellas)

**Interfaces:**
- Consumes: Task 1 pre-flight pass.
- Produces: ~150 flagged ES rows + a triage report for Task 5.

- [ ] **Step 1: Run authoring against prod**

```bash
cd /Users/seal/dev/language-drill
DATABASE_URL="$PROD_DB" ANTHROPIC_API_KEY="$AK" \
  pnpm --filter @language-drill/db generate:vocab-targets --language ES --level A2
```

Expected output: `Authoring 5 ES A2 vocab umbrella(s), ~30 words each.` then per-umbrella `[es-a2-vocab-…] proposed N, kept K, inserted I` with kept ≈ 25–30 each. If an umbrella keeps < 15, re-run once (idempotent; avoid-list tops it up), then report if still short.

- [ ] **Step 2: Triage the flagged list**

```bash
DATABASE_URL="$PROD_DB" pnpm --filter @language-drill/db review:flagged-vocab --language ES > /private/tmp/claude-502/-Users-seal-dev-language-drill/508c47f0-955f-401c-ac04-9af368523688/scratchpad/triage-es-a2.txt
```

Read the full list. For every word check: (1) plausibly A2 (not C1-rare, not sub-A1 trivial — freqRank is the hint, `n/a` rank deserves a look); (2) on-theme for its umbrella; (3) gloss matches the lemma's common meaning; (4) example sentence is level-appropriate and actually contains the display form; (5) no cross-umbrella duplicates within the run. Write `scratchpad/triage-es-a2-report.md`: per umbrella, a "suspicious" table (id, word, reason) and a one-line verdict. Do **not** approve anything.

### Task 4: Author TR A2 + TR B1 (10 umbrellas)

**Interfaces:**
- Consumes: Task 1 pre-flight pass.
- Produces: ~300 flagged TR rows + triage report for Task 5.

- [ ] **Step 1: Run both scopes** (sequentially; both land as `flagged` TR rows)

```bash
DATABASE_URL="$PROD_DB" ANTHROPIC_API_KEY="$AK" \
  pnpm --filter @language-drill/db generate:vocab-targets --language TR --level A2
DATABASE_URL="$PROD_DB" ANTHROPIC_API_KEY="$AK" \
  pnpm --filter @language-drill/db generate:vocab-targets --language TR --level B1
```

Expected: `Authoring 5 TR A2…` / `Authoring 5 TR B1…`, kept ≈ 25–30 per umbrella.

- [ ] **Step 2: Triage** — same procedure and criteria as Task 3 Step 2 (`--language TR`, output `triage-tr-a2-b1.txt` / `triage-tr-a2-b1-report.md`). B1 additionally: reject words that are really A1/A2 core (the level window should move up).

### Task 5: USER GATE → approve ES + TR

**Interfaces:**
- Consumes: triage reports from Tasks 3–4.
- Produces: approved ES A2 / TR A2 / TR B1 target pools (scheduler picks them up next ~04:00 UTC run automatically — data-gated, no deploy needed).

- [ ] **Step 1: Present both triage reports to the user; wait for per-language OK.** If the user rejects specific words, delete those rows first: `psql "$PROD_DB" -c "DELETE FROM vocab_target WHERE id IN ('<id>', …);"` (flagged rows only — never delete approved rows here).
- [ ] **Step 2: Approve**

```bash
DATABASE_URL="$PROD_DB" pnpm --filter @language-drill/db review:flagged-vocab --language ES --approve-all
DATABASE_URL="$PROD_DB" pnpm --filter @language-drill/db review:flagged-vocab --language TR --approve-all
```

Expected: `Approved N ES row(s).` / `Approved N TR row(s).` matching triage counts minus deletions.

- [ ] **Step 3: Verify** — re-run Task 1 Step 2 query; ES now has A1+A2 approved, TR has A1+A2+B1 approved, zero flagged anywhere.

---

## Track B — curriculum PR (~30 new umbrellas)

### Task 6: Worktree + DE umbrellas (17 new) + DE count test

**Files:**
- Modify: `packages/db/src/curriculum/de.ts` (vocab section starts near line 2630, marker `// Vocab umbrellas — kind: 'vocab'`)
- Test: `packages/db/src/curriculum/curriculum.test.ts` (DE parity test, ~line 710)

**Interfaces:**
- Produces: DE vocab umbrella keys used by Track C: `de-a1-vocab-{family-people,food-drink,home-objects,city-transport,weather-clothing}`, `de-a2-vocab-{work-school,city-shopping,health-body,travel-nature}`, `de-b1-vocab-{media-news,education-career,emotions-relationships,opinions-society}`, `de-b2-vocab-{work-professional,science-technology,society-politics,culture-media}`.

- [ ] **Step 1: Create the worktree**

```bash
cd /Users/seal/dev/language-drill
git worktree add .claude/worktrees/vocab-umbrella-expansion -b feat/vocab-umbrella-expansion
cd .claude/worktrees/vocab-umbrella-expansion && git branch --show-current  # → feat/vocab-umbrella-expansion
```

All subsequent Track-B paths are relative to this worktree root — use absolute paths prefixed with `/Users/seal/dev/language-drill/.claude/worktrees/vocab-umbrella-expansion/`.

- [ ] **Step 2: Update the DE count test first (failing)**

In `curriculum.test.ts`, DE parity test: title `… and has 3 vocab umbrellas` → `… and has 20 vocab umbrellas`; replace the vocab assertion + comment:

```ts
    // 5 A1 + 5 A2 + 5 B1 + 5 B2 themed umbrellas (2026-07-17 expansion):
    // each level keeps its original broad umbrella (housing / environment /
    // academic-noun) as one of its themes. Dictation / free-writing /
    // paraphrase umbrellas remain a follow-up (see the 2026-07-12 plan doc).
    expect(vocab).toBe(20);
```

- [ ] **Step 3: Run it — verify it fails**

```bash
pnpm --filter @language-drill/db exec vitest run src/curriculum/curriculum.test.ts -t 'German'
```

Expected: FAIL — `expected 3 to be 20`.

- [ ] **Step 4: Author the 17 DE entries**

Insert into the vocab section of `de.ts` grouped by level (new A1 block first, then the A2 entries around the existing `de-a2-housing-vocab`, B1 around `de-b1-environment-vocab`, B2 around `de-b2-academic-noun-vocab`). Ground word-domain choices in Goethe/Profile Deutsch themes; consult the Hammer mirror (`/Users/seal/dev/language-tools/German/german-grammar-book/german-grammar-md`) only for the grammar-flavored commonErrors (gender/plural traps). Full model entry — `de-a1-vocab-family-people` (write the remaining 16 to exactly this shape and density):

```ts
  {
    key: 'de-a1-vocab-family-people',
    kind: 'vocab',
    name: 'Family and people (A1)',
    description:
      'Core A1 vocabulary for family members, people, and basic personal descriptions.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: ['die Mutter', 'der ältere Bruder'],
    examplesNegative: ['*der Mutter (as nominative)'],
    commonErrors: [
      'Mismatching article gender on family nouns ("*der Mutter" as subject).',
      'Confusing "die Eltern" (parents) with "die Verwandten" (relatives).',
    ],
  },
```

Per-entry themes (name / description gist):

| Key | Name | Description covers |
|---|---|---|
| de-a1-vocab-family-people | Family and people (A1) | family members, people, basic personal descriptions |
| de-a1-vocab-food-drink | Food and drink (A1) | staple foods, fruit, vegetables, everyday drinks |
| de-a1-vocab-home-objects | Home and objects (A1) | rooms, furniture, everyday household objects |
| de-a1-vocab-city-transport | City and transport (A1) | places in town, transport means, simple directions |
| de-a1-vocab-weather-clothing | Weather and clothing (A1) | weather, seasons, clothing items |
| de-a2-vocab-work-school | Work and school (A2) | jobs, workplaces, school subjects, study activities |
| de-a2-vocab-city-shopping | City and shopping (A2) | shops, services, money, shopping activities |
| de-a2-vocab-health-body | Health and body (A2) | body parts, symptoms, common complaints |
| de-a2-vocab-travel-nature | Travel and nature (A2) | travel, landscapes, the outdoors |
| de-b1-vocab-media-news | Media and news (B1) | news, media formats, current-events reporting |
| de-b1-vocab-education-career | Education and career (B1) | study paths, qualifications, career development |
| de-b1-vocab-emotions-relationships | Emotions and relationships (B1) | feelings, interpersonal relationships, conflict |
| de-b1-vocab-opinions-society | Opinions and society (B1) | expressing views, social issues, public life |
| de-b2-vocab-work-professional | Professional life (B2) | workplace processes, contracts, professional communication |
| de-b2-vocab-science-technology | Science and technology (B2) | research, technology, innovation, digitalisation |
| de-b2-vocab-society-politics | Society and politics (B2) | political institutions, civic life, social debates |
| de-b2-vocab-culture-media | Culture and media (B2) | arts, cultural life, media criticism |

coverageSpec decisions: `de-a1-vocab-food-drink` gets the TR-precedent floor with the same comment style —

```ts
    coverageSpec: {
      // wordClass diversity: food/drink vocab is noun-dominant, with a few verbs
      // (eat/drink) and adjectives (tastes). Floors sum to the vocab target (10).
      axes: [{ name: 'wordClass', floors: { noun: 6, verb: 2, adjective: 2 } }],
    },
```

All 16 others: **no coverageSpec** — add one shared comment above the new A1 block: `// coverageSpec: intentionally none on the umbrellas below (open noun-dominant identity space; matches the ES/TR vocab-umbrella decision) — except food-drink, floored like tr-a1-vocab-food-drink.`

- [ ] **Step 5: Run the test — verify it passes**

Same command as Step 3. Expected: PASS. Also run the full curriculum + book-coverage tests: `pnpm --filter @language-drill/db exec vitest run src/curriculum/ ` — expected all pass (vocab umbrellas claim no book sections).

- [ ] **Step 6: Commit**

```bash
git branch --show-current  # assert feat/vocab-umbrella-expansion
git add packages/db/src/curriculum/de.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(curriculum): DE themed vocab umbrellas A1-B2 (17 new, 20 total)"
```

### Task 7: ES B1/B2 umbrellas (8 new) + ES count test

**Files:**
- Modify: `packages/db/src/curriculum/es.ts` (vocab section ~line 3182; insert the B1 themes before `es-b1-environment-vocab`'s sibling ordering is not required — append after `es-b2-abstract-noun-vocab`, keeping A1→B2 grouping comments)
- Test: `curriculum.test.ts` ES parity test (~line 694)

**Interfaces:**
- Produces: keys `es-b1-vocab-{media-news,education-career,emotions-relationships,opinions-society}`, `es-b2-vocab-{work-professional,science-technology,society-politics,culture-arts}`.

- [ ] **Step 1: Update the ES count test (failing):** title `has 12 vocab umbrellas` → `has 20 vocab umbrellas`; comment + assertion:

```ts
    // 5 A1 + 5 A2 themed umbrellas + 4 B1 + 4 B2 themed umbrellas (2026-07-17
    // expansion) + es-b1-environment-vocab + es-b2-abstract-noun-vocab kept as
    // one theme of their levels.
    expect(vocab).toBe(20);
```

- [ ] **Step 2: Run — verify FAIL** (`expected 12 to be 20`): `pnpm --filter @language-drill/db exec vitest run src/curriculum/curriculum.test.ts -t 'Spanish'`
- [ ] **Step 3: Author the 8 ES entries.** Same shape as the existing ES umbrellas in the same file (Spanish examples, `*`-marked negatives, two concrete commonErrors — gender traps, false friends). Themes mirror the DE/TR B-level table: B1 media-news / education-career / emotions-relationships / opinions-society; B2 work-professional / science-technology / society-politics / culture-arts. Ground register choices in PCIC B1/B2 topic lists; the B&B mirror (`/Users/seal/dev/language-tools/Spanish/spanish-grammar-book/spanish-grammar-md`) only for commonErrors. No coverageSpec on any (comment: `// coverageSpec: intentionally none — open noun-dominant identity space (matches the existing ES vocab-umbrella decision).`).
- [ ] **Step 4: Run — verify PASS**, plus `vitest run src/curriculum/`.
- [ ] **Step 5: Commit** (assert branch first): `feat(curriculum): ES themed vocab umbrellas B1/B2 (8 new, 20 total)`

### Task 8: TR B2 umbrellas (5 new) + TR count test

**Files:**
- Modify: `packages/db/src/curriculum/tr.ts` (vocab section; append after `tr-b1-vocab-abstract-concepts`)
- Test: `curriculum.test.ts` TR parity test (~line 726)

**Interfaces:**
- Produces: keys `tr-b2-vocab-{work-professional,science-technology,society-politics,culture-arts,global-issues}`.

- [ ] **Step 1: Update the TR count test (failing):** title `has 15 vocab umbrellas` → `has 20 vocab umbrellas`; comment/assertion `// 5 each A1/A2/B1 + 5 B2 themed umbrellas (2026-07-17 expansion).` `expect(vocab).toBe(20);`. Also update the stale B2 comment above `expect(grammar.B2)` — drop the "Grammar-only — no B2 vocab/dictation/free-writing" clause in favor of `// B2 dictation/free-writing remain out of scope; B2 vocab umbrellas added 2026-07-17.`
- [ ] **Step 2: Run — verify FAIL** (`expected 15 to be 20`): `-t 'Turkish'`.
- [ ] **Step 3: Author the 5 TR entries.** Same shape as existing TR umbrellas (Turkish examples; commonErrors favor suffix/vowel-harmony traps and Arabic/French loanword confusions). Themes: work-professional, science-technology, society-politics, culture-arts, global-issues — grounded in Yedi İklim B2 unit topics (mirror sibling `Yedi İklim/` dir next to the G&K book at `/Users/seal/dev/language-tools/Turkish/turkish-grammar-book/`). No coverageSpec (same comment as Task 7).
- [ ] **Step 4: Run — verify PASS**, plus `vitest run src/curriculum/`.
- [ ] **Step 5: Commit** (assert branch): `feat(curriculum): TR themed vocab umbrellas B2 (5 new, 20 total)`

### Task 9: Version bumps + full gates + PR

**Files:**
- Modify: `packages/db/src/curriculum/de.ts:66`, `packages/db/src/curriculum/es.ts:175`, `packages/db/src/curriculum/tr.ts:186` (version constants + their changelog comment blocks)

**Interfaces:**
- Consumes: Tasks 6–8 committed.
- Produces: the PR for Task 10.

- [ ] **Step 1: Bump all three `CURRICULUM_VERSION_*` constants.** Rule: set to today's actual date with suffix `a`; if the constant already carries today's date, increment the letter (current values: DE `2026-07-17a`, ES `2026-07-17a`, TR `2026-07-17c` → on 2026-07-17 they'd become `2026-07-17b`, `2026-07-17b`, `2026-07-17d`; on a later day, `<date>a`). Add one changelog line to each file's version-comment block, e.g. for de.ts: `* <new version>: themed vocab umbrellas A1–B2 (17 new; re-enqueues the 3 broad-umbrella cells and enqueues the 17 new ones).` The bump is required — new cells enqueue on version change, and it clears any skip-low-yield suppression.
- [ ] **Step 2: Full gates from the worktree root**

```bash
rm -rf infra/lambda/dist && pnpm build
pnpm lint && pnpm typecheck && pnpm test
```

Expected: zero failures. Known trap: if `infra` synth tests fail with esbuild exit 254, symlink esbuild into root node_modules (environmental — see memory) and re-run.

- [ ] **Step 3: Commit + push + PR**

```bash
git branch --show-current   # assert
git add -A && git commit -m "feat(curriculum): version bumps for vocab umbrella expansion"
git push -u origin feat/vocab-umbrella-expansion
ghp pr create --title "feat(curriculum): themed vocab umbrellas — full A1–B2 parity (30 new, 20 per language)" --body "<summary: what/why, per-language tables, coverageSpec decisions, version bumps; footer: 🤖 Generated with [Claude Code](https://claude.com/claude-code)>"
```

(Use the `ghp` alias — personal GitHub account.)

### Task 10: USER GATE — PR review, merge, deploy

- [ ] **Step 1:** User reviews/merges (squash; edit the squash message to the PR summary). CI must be green (Neon branch forks from dev — if migrations-related `relation already exists` noise appears it's the known fork-pollution issue, not this PR; this PR has no migration).
- [ ] **Step 2:** After merge, confirm the deploy workflow (migrate → CDK → Vercel) completes. The scheduler Lambda picks up the new curriculum on the next ~04:00 UTC run; Track C's authoring does **not** need to wait for that run — it only needs the merged curriculum locally (`git -C /Users/seal/dev/language-drill pull` on main) because `generate:vocab-targets` reads `ALL_CURRICULA` from the working tree.
- [ ] **Step 3:** Clean up: `git worktree remove .claude/worktrees/vocab-umbrella-expansion` (branch ref survives; already pushed).

---

## Track C — post-merge data curation

### Task 11: Author DE A1–B2, ES B1/B2, TR B2 (7 scopes, 30 umbrellas)

**Interfaces:**
- Consumes: merged main (Task 10), pre-flight DE-band pass (Task 1).
- Produces: ~900 flagged rows + triage reports for Task 12.

- [ ] **Step 1: From fresh main** (`git checkout main && git pull`; assert `git log --oneline -1` includes the merge), re-pull `$PROD_DB`/`$AK`, then run each scope exactly once:

```bash
for LVL in A1 A2 B1 B2; do
  DATABASE_URL="$PROD_DB" ANTHROPIC_API_KEY="$AK" \
    pnpm --filter @language-drill/db generate:vocab-targets --language DE --level $LVL
done
DATABASE_URL="$PROD_DB" ANTHROPIC_API_KEY="$AK" pnpm --filter @language-drill/db generate:vocab-targets --language ES --level B1
DATABASE_URL="$PROD_DB" ANTHROPIC_API_KEY="$AK" pnpm --filter @language-drill/db generate:vocab-targets --language ES --level B2
DATABASE_URL="$PROD_DB" ANTHROPIC_API_KEY="$AK" pnpm --filter @language-drill/db generate:vocab-targets --language TR --level B2
```

Expected: `Authoring 5 …` per scope (DE A2/B1/B2 also re-touch their broad umbrella — that's the **first** authoring run for those umbrellas, so they get their initial ~30 like everyone else). Kept ≈ 25–30 per umbrella; re-run a short umbrella once as in Task 3.

- [ ] **Step 2: Triage** — Task 3 Step 2 procedure per language (`triage-de-a1-b2-report.md`, `triage-es-b1-b2-report.md`, `triage-tr-b2-report.md`). DE A1 extra check: display forms must carry the article (`die Mutter`) — the coverage matcher normalizes either way, but the learner-facing form needs the gender.

### Task 12: USER GATE → approve DE + ES + TR

- [ ] **Step 1:** Present the three triage reports; per-language OK; delete user-rejected flagged rows (Task 5 Step 1 pattern).
- [ ] **Step 2:** `review:flagged-vocab --language {DE,ES,TR} --approve-all` (three runs, prod URL). Expected counts match triage minus deletions.
- [ ] **Step 3:** Verify via the Task 1 Step 2 query: all 12 scopes have approved targets; zero flagged.

### Task 13: Convergence verification (1–2 nights later)

**Interfaces:**
- Consumes: approved pools (Tasks 5 + 12) and at least one ~04:00 UTC scheduler run after each.

- [ ] **Step 1: Coverage query per scope**

```bash
psql "$PROD_DB" -c "SELECT t.language, t.cefr_level, t.umbrella_key,
  COUNT(*) AS targets,
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM exercises e
    WHERE e.type='vocab_recall' AND e.grammar_point_key = t.umbrella_key
      AND e.review_status IN ('auto-approved','manual-approved')
      AND lower(trim(e.content_json->>'expectedWord')) = lower(trim(t.lemma)))) AS covered
  FROM vocab_target t WHERE t.status='approved'
  GROUP BY 1,2,3 ORDER BY 1,2,3;"
```

Expected: `covered` climbing toward `targets` per umbrella night over night (~1–2 nights per scope; ES/TR A1 rows serve as the converged reference from Task 1). Note the SQL matches on lemma only — the runtime matcher also accepts displayForm, so treat this as a lower bound; check the Progress → words UI for the authoritative view.

- [ ] **Step 2: Health checks** — generation-run stats for the vocab cells (approval rate in the normal band, no flag-tag spike); no duplicate regression (Task 2 Step 1 count query per language returns 0). Transient failed jobs self-recover next nightly run — only report cells that stay uncovered after 3 nights.
- [ ] **Step 3: Final report to the user** — per-scope coverage table + anything anomalous. Done means all 12 scopes converged or have a named, investigated blocker.
