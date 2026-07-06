# ES B1/B2 PCIC Curriculum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the ES B1/B2 curriculum to PCIC + B&B parity: rescope 5 existing points, add 14 B1 + 18 B2 grammar points (totals 19/23), no DB migration, one PR.

**Architecture:** All data lives in `packages/db/src/curriculum/es.ts`, validated by `assertCurriculumInvariants` via `curriculum.test.ts`. Content batches append points; minimums are raised only at the end so every task is independently green. No key renames ⇒ no migration.

**Tech Stack:** TypeScript (pnpm + Turborepo), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-06-es-b1-b2-pcic-curriculum-design.md` — authoritative per-point scope brief. Read it first.

## Global Constraints

- **Branch/worktree:** `.claude/worktrees/es-b1-b2-pcic/` on branch `feat/es-b1-b2-pcic-curriculum`, created from the freshly pulled `origin/main` (must contain the merged A1/A2 curriculum — verify `grep -c "kind: 'grammar'" packages/db/src/curriculum/es.ts` prints 59 before starting). `pnpm install` in the worktree first. Before EVERY commit: `git branch --show-current` must print `feat/es-b1-b2-pcic-curriculum`; abort otherwise.
- **All paths worktree-relative.** Never edit via the main-checkout path.
- **Content grounding:** PCIC refs (in the spec tables) fix scope and level; B&B chapters (markdown under `/Users/seal/dev/language-tools/Spanish/spanish-grammar-book/spanish-grammar-md/chapters/`, searchable `index.json`) fix linguistic content. Read the listed chapters before authoring; never copy B&B text verbatim; never invent paradigms from memory.
- **Entry invariants:** key `/^es-(b1|b2)-[a-z0-9-]+$/` matching `cefrLevel`; description ≤ 300 chars English naming the spec table's exact forms/contrasts; `examplesPositive` ≥ 2 (B-level Spanish is fine — subjunctive/past tenses expected); `examplesNegative` ≥ 1 each starting `*`, genuinely ungrammatical; `commonErrors` ≥ 1 realistic; `prerequisiteKeys` must resolve to keys already present in the array.
- **B-level person coverageSpec** (exact object, only where a task says so):
  ```ts
  coverageSpec: {
    axes: [
      { name: 'person', floors: { '1sg': 15, '2sg': 15, '3sg': 15, '1pl': 15, '3pl': 15 } },
    ],
  },
  ```
- **Overlap discipline (binding):** volver a / acabar de / soler / tener que / hay que live at A2 (`es-a2-periphrases-obligation-aspect`); por/para, personal a, -mente formation, double negation live at A2; -ísimo lives at B1 (`es-b1-superlatives-comparisons`); deber-de-probability lives at `es-b1-deber-obligation-probability` (NOT in futuro-simple's probability value); reported-future "dijo que vendría" is OUT of `es-b1-reported-speech` (B2 consecutio); explicativas/el-que-relatives are OUT of the B1 relative point.
- **Array order:** new B1 points append after `es-b1-passive-se`; new B2 points append after `es-b2-nuanced-ser-estar` (before the vocab umbrellas); each batch in its table order.
- **Theory categories:** every new point's mapping added to `KEY_TO_CATEGORY` (`packages/shared/src/theory-categories.ts`, new `// --- Spanish (B1) ---` / `(B2 additions)` groupings near the existing ES entries) AND mirrored in `EXPECTED_KEY_CATEGORY` (`theory-categories.test.ts`), in the same commit as the points.
- **Tests per task:** `pnpm build && pnpm --filter @language-drill/db test && pnpm --filter @language-drill/shared test` — all green before each commit.
- **CURRICULUM_VERSION_ES:** bumped ONCE in Task 1 to the commit date (`YYYY-MM-DD`); if that equals the current on-disk value (`'2026-07-06'`), use the next day (`'2026-07-07'`) — the constant is a comparison tag, forward-dating is harmless. Later tasks do not touch it.
- **No prompt edits, no Langfuse push, no DB migration, no new files.**

---

### Task 1: Rescope the five existing points + version bump

**Files:**
- Modify: `packages/db/src/curriculum/es.ts`

**Interfaces:**
- Consumes: existing entries `es-b1-present-subjunctive`, `es-b1-conditional`, `es-b1-llevar-time-expressions`, `es-b1-relative-clauses`, `es-b2-compound-tenses`.
- Produces: rescoped descriptions later batches must not contradict; the version bump.

- [ ] **Step 1: Bump `CURRICULUM_VERSION_ES`** per the Global Constraints rule, appending to its doc comment:

```ts
 * `<DATE>`: ES B1/B2 expanded to PCIC B1-B2 parity (14 new B1 + 18 new B2
 * grammar points; 5 existing points rescoped — pluperfect moved out of
 * es-b2-compound-tenses to a new B1 point). Bump enumerates the new cells and
 * clears suppression on the rescoped cells so they re-run under the new
 * descriptions. See docs/superpowers/specs/2026-07-06-es-b1-b2-pcic-curriculum-design.md.
```

- [ ] **Step 2: Apply the five rescopes.** Replace each entry's `description` with EXACTLY the string below; adjust `name`, examples, and commonErrors only where noted (keep everything else, including flags/coverageSpec/prereqs, untouched):

1. `es-b1-present-subjunctive` description →
```
'Present subjunctive: forms (incl. inherited stem changes) after wish, doubt, emotion, and impersonal-judgement triggers (querer que, espero que, dudo que, es importante que), and in independent uses with ojalá (que) and quizá / tal vez.'
```
Add one positive example showcasing an independent use (author it, B&B ch. 20-grounded, e.g. an ojalá sentence).

2. `es-b1-conditional` description →
```
'Conditional simple: regular forms and the irregular stems shared with the future (tendría, haría, podría), used for polite requests (¿Podrías ayudarme?), modest opinions (yo diría que...), and advice (deberías + infinitive).'
```
Replace the hypothetical positive example (`'Yo iría contigo si pudiera.'`) with a modesty/advice example (author it); replace the commonError about hypothetical statements with one about using the present/future instead of the conditional in polite requests. The `*Yo iré contigo si pudiera.` negative must also be replaced (its si-clause is now out of scope) with an ungrammatical courtesy/advice-frame item.

3. `es-b1-llevar-time-expressions` name → `'Duration and time-span expressions'`; description →
```
'Duration and time-span expressions: llevar + period + gerund (Llevo dos años estudiando), hace + period + que + present, tardar + period + en + infinitive (Tardé dos horas en llegar), and dentro de + period for time from now.'
```
Add one positive example each for tardar en and dentro de (author them, B&B ch. 36-grounded).

4. `es-b1-relative-clauses` description →
```
'Restrictive relative clauses in the indicative: que vs quien (a quien for human objects: el chico a quien saludaste), donde with an expressed antecedent, and the restriction that proper names and tonic pronouns reject restrictive relatives.'
```
Remove any example or commonError referencing `lo que` or non-restrictive/comma-set clauses (they move to `es-b2-relative-clauses-advanced` in Task 4); replace with que/quien-opposition material.

5. `es-b2-compound-tenses` name → `'Future perfect'`; description →
```
'Future perfect: habré + past participle for actions completed before a future reference point (Cuando lleguemos ya se habrá ido) and for probability about the recent past (Habrá tenido problemas).'
```
Replace the pluperfect positive example (`'Habíamos terminado antes de las ocho.'`) with a second future-perfect example (author it); update commonErrors to future-perfect-specific errors (e.g. using the simple future where anteriority is required). Keep `prerequisiteKeys: ['es-a2-preterito-perfecto']` and the person coverageSpec.

- [ ] **Step 3: Run tests**

Run: `pnpm build && pnpm --filter @language-drill/db test && pnpm --filter @language-drill/shared test`
Expected: PASS (counts unchanged; invariants hold on the edited entries).

- [ ] **Step 4: Commit**

```bash
git branch --show-current   # must print feat/es-b1-b2-pcic-curriculum
git add packages/db/src/curriculum/es.ts
git commit -m "feat(curriculum): rescope ES B1/B2 points to PCIC levels; bump curriculum version"
```

---

### Content-authoring template (Tasks 2–6)

Each content task appends `kind: 'grammar'` entries to es.ts in its table order, per the Global Constraints invariants. Fully worked example — this is Task 2 point 1, copy VERBATIM:

```ts
  {
    key: 'es-b1-futuro-simple',
    kind: 'grammar',
    name: 'Future simple',
    description:
      'Futuro imperfecto: regular endings on the infinitive (hablaré, comerás) and the irregular stems tendr-, saldr-, sabr-, podr-, har-, dir-; absolute future statements and the future of probability (Serán las once).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: ['Mañana iré al médico a primera hora.', '¿Qué hora es? — Serán las once.'],
    examplesNegative: ['*Mañana teneré una reunión importante.'],
    commonErrors: [
      'Regularising irregular stems ("*teneré", "*saliré" instead of "tendré", "saldré").',
      'Reaching for ir a + infinitive in formal writing where the simple future is expected.',
      'Missing the written accent on the endings ("*hablare" instead of "hablaré").',
    ],
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 15, '2sg': 15, '3sg': 15, '1pl': 15, '3pl': 15 } },
      ],
    },
    conjugationSuitable: true,
  },
```

For every other point: read the B&B chapters in the spec's table row, author `name`/`description`/`examplesPositive`/`examplesNegative`/`commonErrors` so the description names the spec row's exact forms/contrasts, every Spanish sentence is B&B-verified, and commonErrors are real learner errors. Optional fields ONLY where the task's flag list says so, in the order `prerequisiteKeys`, `coverageSpec`, `conjugationSuitable`.

In the SAME commit: add the batch's theory-category mappings (+ test mirrors) using the spec table's Category column.

Each task ends with the template test run and a commit:

Run: `pnpm build && pnpm --filter @language-drill/db test && pnpm --filter @language-drill/shared test` → PASS

```bash
git branch --show-current   # must print feat/es-b1-b2-pcic-curriculum
git add packages/db/src/curriculum/es.ts packages/shared/src/theory-categories.ts packages/shared/src/theory-categories.test.ts
git commit -m "feat(curriculum): <task summary>"
```

---

### Task 2: B1 batch 1 — tenses & moods (7 points)

**Files:** Modify `packages/db/src/curriculum/es.ts`, `packages/shared/src/theory-categories.ts`, `packages/shared/src/theory-categories.test.ts`.

**Interfaces:** Produces `es-b1-subjunctive-adverbial` (prereq target for Task 4's `es-b2-subjunctive-temporal-concessive`).

Append after `es-b1-passive-se`, in this order (scopes/PCIC/B&B/categories in the spec's Section-2 table):

1. `es-b1-futuro-simple` — VERBATIM worked example above. Category `tenses`.
2. `es-b1-pluperfect` — flags: `prerequisiteKeys: ['es-a2-preterito-perfecto']` + person coverageSpec (NO conjugationSuitable). Category `tenses`.
3. `es-b1-past-narration` — no flags. Category `tenses`. Must include al + infinitivo (Al llegar, lo vi) alongside the imperfecto/indefinido interplay and conato.
4. `es-b1-imperative-negative-pronouns` — flags: `prerequisiteKeys: ['es-a2-imperative-affirmative']`. Category `moods`. Negative imperative = subjunctive + proclisis; affirmative multi-clitic enclisis with accents (díselo, dámelas).
5. `es-b1-subjunctive-adverbial` — flags: `prerequisiteKeys: ['es-b1-present-subjunctive']`. Category `moods`.
6. `es-b1-reported-speech` — no flags. Category `syntax`. Scope stops at B1: statement shift (dijo que tenía) + imperative → que + presente de subjuntivo; NO "dijo que vendría".
7. `es-b1-deber-obligation-probability` — no flags. Category `pairs`. deber + inf vs deber de + inf; deberías advice.

- [ ] Steps: read B&B chapters → append 7 entries (point 1 verbatim) → add 7 mappings + mirrors → run tests (PASS) → commit (`feat(curriculum): ES B1 batch 1 — future, pluperfect, narration, imperatives, subjunctive triggers`).

---

### Task 3: B1 batch 2 — syntax & pairs (7 points)

**Files:** same trio.

**Interfaces:** completes the 19-point B1 set (Task 7 asserts ≥ 19).

Append after Task 2's entries, in this order (spec Section-2 table rows 8–14):

8. `es-b1-aspectual-periphrases` — Category `syntax`. dejar de / ponerse a / estar a punto de + inf; seguir + gerundio. Do NOT include volver a, acabar de, soler, tener que, hay que (A2 property).
9. `es-b1-verb-preposition-regime` — Category `syntax`. hablar de, pensar en, soñar con, depender de; me invitó a cenar.
10. `es-b1-discourse-connectors` — Category `syntax`. sin embargo; o sea que / así (es) que; fronted causal como; por + infinitivo causal; aunque + indicative.
11. `es-b1-superlatives-comparisons` — Category `syntax`. el más/menos … de; -ísimo; igual de … que; más/menos de + quantity.
12. `es-b1-que-vs-cual` — Category `pairs`. qué vs cuál/cuáles (incl. *¿Cuál libro…?); preposition + interrogative; adónde.
13. `es-b1-ser-estar-uses` — Category `pairs`. Es tarde / Es de noche; estar de + occupation; estar a + prices/dates; parecer + adj vs parece que.
14. `es-b1-indirect-questions` — Category `syntax`. no sé si ir / qué hacer; pregúntale dónde está.

- [ ] Steps: read chapters → append 7 entries → mappings + mirrors → tests (PASS) → commit (`feat(curriculum): ES B1 batch 2 — periphrases, regime, connectors, comparisons, interrogatives`).

---

### Task 4: B2 batch 1 — subjunctive systems (5 points)

**Files:** same trio.

**Interfaces:** Consumes `es-b1-present-subjunctive`, `es-b1-subjunctive-adverbial`, `es-b2-past-subjunctive` (prereq targets).

Append after `es-b2-nuanced-ser-estar`, in this order (spec Section-3 rows 1–4, 9):

1. `es-b2-relative-clauses-advanced` — Category `syntax`. Explicativas; el/la/los/las que + preposition; quien(es) ± antecedent; donde relatives; ind/subj contrast (busco un libro que sea…). This point now owns `lo que` relatives removed from the B1 point in Task 1.
2. `es-b2-subjunctive-compound` — flags: `prerequisiteKeys: ['es-b1-present-subjunctive', 'es-b2-past-subjunctive']`. Category `moods`. haya hecho; hubiera/hubiese hecho (forms + core uses).
3. `es-b2-subjunctive-negated-opinion` — flags: `prerequisiteKeys: ['es-b1-present-subjunctive']`. Category `moods`. no creo que + subj vs creo que + ind; no es cierto/verdad que.
4. `es-b2-subjunctive-temporal-concessive` — flags: `prerequisiteKeys: ['es-b1-subjunctive-adverbial']`. Category `moods`. en cuanto / tan pronto como / apenas / una vez que / hasta que / mientras + subj; aunque / a pesar de que + subj; por mucho/más que.
5. `es-b2-conditional-connectors` — Category `moods`. por si (acaso); siempre que / siempre y cuando / con tal de que / a condición de que + subj; salvo si / excepto si + ind; a no ser que / salvo que + subj.

- [ ] Steps: read chapters → append 5 entries → mappings + mirrors → tests (PASS) → commit (`feat(curriculum): ES B2 batch 1 — subjunctive systems and conditional connectors`).

---

### Task 5: B2 batch 2 — verbs & pronouns (5 points)

**Files:** same trio.

Append after Task 4's entries (spec Section-3 rows 5–8, 15):

6. `es-b2-passive-voice` — Category `syntax`. ser + participle action passive vs estar + participle result; agreement; postverbal bare-noun subjects.
7. `es-b2-verbs-of-change` — Category `syntax`. ponerse, quedarse, hacerse, volverse, convertirse en, llegar a ser — which "become" for which change.
8. `es-b2-se-middle-accidental` — Category `pronouns`. Se abrió la ventana; se me perdió; irse vs ir.
9. `es-b2-clitic-advanced` — Category `pronouns`. Lo soy / Lo está; Los libros los tiene Juan; leísmo de persona acceptance.
10. `es-b2-gerund-participle-constructions` — Category `syntax`. Adverbial gerund; nada más + inf; una vez + participle; predicative participle.

- [ ] Steps: read chapters → append 5 entries → mappings + mirrors → tests (PASS) → commit (`feat(curriculum): ES B2 batch 2 — passive, change-of-state, se values, clitics, non-finite clauses`).

---

### Task 6: B2 batch 3 — connectors & structures (8 points)

**Files:** same trio.

**Interfaces:** completes the 23-point B2 set (Task 7 asserts ≥ 23).

Append after Task 5's entries (spec Section-3 rows 10–14, 16–18):

11. `es-b2-consecutives-intensity` — Category `syntax`. tan … que / tanto/a/os/as … que / tanto que; de manera que; por lo tanto, por consiguiente.
12. `es-b2-sino-adversatives` — Category `pairs`. pero vs sino / sino que; no obstante.
13. `es-b2-causal-connectors` — Category `syntax`. ya que, puesto que, debido a que; enunciation porque.
14. `es-b2-lo-nominalizer` — Category `syntax`. lo + adjective; lo de + NP; lo que clauses; lo + adj + que intensifier; el porqué.
15. `es-b2-comparatives-advanced` — Category `syntax`. más/menos … de lo que; superior/inferior a; el doble de / tres veces más; igual que; más N que N.
16. `es-b2-quantifiers-advanced` — Category `syntax`. cualquier / cualquiera; partitives; multiplicatives; tres de cada cinco; algo + adj.
17. `es-b2-cleft-sentences` — Category `syntax`. Fue Juan quien/el que llamó; Es aquí donde…; Lo que necesito es…; relator agreement per focus type. Keep distinct from lo-nominalizer (ser-focus is the core) and relative-clauses-advanced.
18. `es-b2-appreciative-suffixes` — Category `morphology`. -ito/-cito, -ón/-azo, -ucho; affective vs lexicalized; recognition-oriented, production capped at core -ito/-ón.

- [ ] Steps: read chapters → append 8 entries → mappings + mirrors → tests (PASS) → commit (`feat(curriculum): ES B2 batch 3 — connectors, nominalizers, clefts, appreciatives`).

---

### Task 7: Lock counts and tidy comments

**Files:**
- Modify: `packages/db/src/curriculum/index.ts`
- Modify: `packages/db/src/curriculum/curriculum.test.ts`

- [ ] **Step 1:** `PER_LANGUAGE_GRAMMAR_MIN.ES` → `{ A1: 22, A2: 27, B1: 19, B2: 23 }`; update the comment above it (ES now full A1–B2 parity; only DE remains reduced).
- [ ] **Step 2:** Spanish counts test: `grammar.B1` → `toBeGreaterThanOrEqual(19)`, `grammar.B2` → `toBeGreaterThanOrEqual(23)`; retitle (`'Spanish is at full PCIC A1–B2 parity …'`). Check the invariant-violation test that trims a level below its minimum still targets a valid level/count after the change (it was updated in the A1/A2 cycle to trim A1 below 22 — likely untouched, verify only).
- [ ] **Step 3:** Run `pnpm build && pnpm --filter @language-drill/db test` → PASS.
- [ ] **Step 4:** Commit (`feat(curriculum): enforce ES B1/B2 minimums at full PCIC parity`).

---

### Task 8: Full gates, push, PR

- [ ] **Step 1:** `rm -rf infra/lambda/dist` (stale-dist phantom-failure guard).
- [ ] **Step 2:** `pnpm lint && pnpm typecheck && pnpm test` from the worktree root. Expected: zero failures. Specifically check `infra/lambda/src/routes/admin.test.ts` (pool-status target whitelist): the new B-level floors sum to 75 (5×15), which is already whitelisted — if this test fails with a new value, add it with a comment per that file's convention and note it in the report.
- [ ] **Step 3:** Push and open the PR (`ghp` alias; squash-merge default):

```bash
git push -u origin feat/es-b1-b2-pcic-curriculum
ghp pr create --title "feat(curriculum): ES B1/B2 expanded to full PCIC parity" --body "$(cat <<'EOF'
Expands ES B1/B2 to Plan Curricular del Instituto Cervantes B1-B2 alignment
plus a Butt & Benjamin reverse-coverage audit:

- 14 new B1 + 18 new B2 grammar points (PCIC-placed, B&B-grounded; per-batch
  linguistic-accuracy reviews) — ES totals now 22/27/19/23
- 5 existing points rescoped to PCIC levels: pluperfect moved out of
  es-b2-compound-tenses (now 'Future perfect') to new es-b1-pluperfect;
  conditional narrowed to courtesy/modesty/advice; relative clauses split
  B1 restrictive vs new B2 advanced point; duration expressions widened
- B&B audit additions: deber vs deber de (B1), cleft sentences (B2),
  appreciative suffixes (B2, recognition-capped)
- No key renames -> no DB migration; CURRICULUM_VERSION_ES bumped
- Grammar only: existing B1/B2 vocab/dictation/free-writing umbrellas untouched

Spec: docs/superpowers/specs/2026-07-06-es-b1-b2-pcic-curriculum-design.md
Plan: docs/superpowers/plans/2026-07-06-es-b1-b2-pcic-curriculum.md

Post-merge (operator checklist):
1. Nothing to push to Langfuse (no prompt edits).
2. Scheduler enumerates ~65 new cells behind the A1/A2 backlog, paced by the
   global budget cap over several nights.
3. Run theory batch generation for the new ES B1/B2 grammar points.
4. Spot-check per-cell approval rates on the admin pool page after the first run.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01XHFb8LPdFAhv5s99hnUXbC
EOF
)"
```

- [ ] **Step 4: Stop.** Post-merge operational steps are for the operator after review + merge.

---

## Self-review notes

- **Spec coverage:** Section 1 rescopes → Task 1; Section 2 (14 B1) → Tasks 2–3; Section 3 (18 B2) → Tasks 4–6; Section 4 mechanics → Tasks 1 (version), 2–6 (categories/flags), 7 (minimums), 8 (whitelist verification); Section 5 rollout → Task 8 + Global Constraints (fresh-main worktree).
- **Prerequisite ordering verified:** every `prerequisiteKeys` target exists before its dependent (a2 keys pre-exist; `es-b1-present-subjunctive`/`es-b2-past-subjunctive` pre-exist; `es-b1-subjunctive-adverbial` lands in Task 2, consumed in Task 4).
- **Flag exactness:** conjugationSuitable ONLY on `es-b1-futuro-simple`; B-level coverageSpec (floors 15) only on futuro-simple + pluperfect; the 75 floor-sum is already in the pool-status whitelist.
- **Counts:** 5 + 7 + 7 = 19 B1; 5 + 5 + 5 + 8 = 23 B2; minimums `{22, 27, 19, 23}` consistent throughout.
