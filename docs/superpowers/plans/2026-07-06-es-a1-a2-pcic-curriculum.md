# ES A1/A2 PCIC Curriculum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore and expand the ES A1/A2 curriculum to full PCIC alignment (21 A1 + 23 A2 grammar points + vocab/dictation/free-writing umbrellas), re-level comparatives from B1 to A2 with a data migration, in one PR.

**Architecture:** All curriculum data lives in `packages/db/src/curriculum/es.ts` as a typed array; structural rules are enforced by `assertCurriculumInvariants` (run from `curriculum.test.ts`). Content-authoring tasks append entries in batches; each batch is independently green because the per-language minimums are only raised at the end. The comparatives re-level is a key rename in code plus a forward-only DML migration.

**Tech Stack:** TypeScript (pnpm + Turborepo monorepo), Vitest, Drizzle ORM migrations (Neon Postgres).

**Spec:** `docs/superpowers/specs/2026-07-06-es-a1-a2-pcic-curriculum-design.md` — read it first; it is the authoritative scope brief per point.

## Global Constraints

- **Branch/worktree:** work in `.claude/worktrees/es-a1-a2-pcic/` on branch `feat/es-a1-a2-pcic-curriculum`. Run `pnpm install` in the worktree before anything else. Before EVERY commit run `git branch --show-current` and abort if it does not print `feat/es-a1-a2-pcic-curriculum` (this repo has a history of branch flips / subagents committing to main).
- **All file paths in this plan are worktree-relative.** Never edit files via the main-checkout absolute path.
- **Content grounding (every grammar entry):** PCIC decides scope and level (the spec's per-point brief); Butt & Benjamin decides linguistic content. B&B chapters are markdown files under `/Users/seal/dev/language-tools/Spanish/spanish-grammar-book/spanish-grammar-md/chapters/` (read-only reference, outside the repo). Before authoring a point, read the B&B chapter file(s) listed in its brief and verify every example sentence and rule claim against them. Do not invent paradigms from memory. `index.json` in that directory is searchable if you need to locate a topic.
- **Entry schema invariants** (enforced by `assertCurriculumInvariants` in `packages/db/src/curriculum/index.ts`):
  - `key` matches `/^es-(a1|a2)-[a-z0-9-]+$/` and its level infix matches `cefrLevel`;
  - `description` ≤ 300 chars, English prose (injected verbatim into generation prompts);
  - `examplesPositive` ≥ 2 (correct Spanish sentences); `examplesNegative` ≥ 1, each starting with `*`; `commonErrors` ≥ 1 (English, learner-error focused);
  - `prerequisiteKeys` must resolve to same-language keys **already present in the array** — never reference a key authored in a later task;
  - `coverageSpec` axes only on `kind: 'grammar'` (`wordClass` only on vocab); `freeWriting` config iff `kind: 'free-writing'`.
- **Person coverageSpec for finite-tense points** (exact object, ES 5-person shape):
  ```ts
  coverageSpec: {
    axes: [
      { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 } },
    ],
  },
  ```
- **Array order matters** (`curriculumOrderOf` drives theory-library ordering): keep the es.ts array ordered A1 grammar → A2 grammar → B1 grammar → B2 grammar → vocab → dictation → free-writing, and within each level in the plan's listed point order.
- **Style:** match the existing es.ts / tr.ts entry style exactly (single quotes, trailing commas, `// ---` section header comments).
- **Test commands:** `pnpm --filter @language-drill/db test` (curriculum invariants + counts + seed map) and `pnpm --filter @language-drill/shared test` (theory categories). Run `pnpm build` first whenever the other package's source changed since the last build (stale-dist resolution is a known trap).
- **CURRICULUM_VERSION_ES** is bumped ONCE (Task 1) to the implementation date in `YYYY-MM-DD` format. Later tasks on this branch do not bump again.
- **No prompt edits anywhere in this plan** ⇒ no `*_PROMPT_VERSION` bumps, no Langfuse push.

---

### Task 1: Scaffold es.ts and re-level comparatives (code side)

**Files:**
- Modify: `packages/db/src/curriculum/es.ts`
- Modify: `packages/db/src/curriculum/index.ts` (PER_LANGUAGE_GRAMMAR_MIN.ES.B1 only)
- Modify: `packages/db/src/curriculum/curriculum.test.ts` (ES B1 count assertion only)
- Modify: `packages/shared/src/theory-categories.ts`
- Modify: `packages/shared/src/theory-categories.test.ts`

**Interfaces:**
- Consumes: existing `es-b1-comparatives-superlatives` entry in es.ts.
- Produces: key `es-a2-comparatives-superlatives` (used by Task 10's migration); `A1`/`A2` in scope in es.ts (used by Tasks 2–8); an empty `// A1` and `// A2` section-comment area in the array where Tasks 2–7 append.

- [ ] **Step 1: Update the es.ts header, destructure, and version**

Replace the file-top "TEMPORARILY REDUCED (2026-05-10)" comment block (lines 5–10) with:

```ts
// ES A1/A2 restored at full PCIC parity (2026-07-06): level placement follows
// the Plan Curricular del Instituto Cervantes Gramática A1-A2 inventory;
// content is grounded in Butt & Benjamin, A New Reference Grammar of Modern
// Spanish. See docs/superpowers/specs/2026-07-06-es-a1-a2-pcic-curriculum-design.md.
```

Change `const { B1, B2 } = CefrLevel;` to `const { A1, A2, B1, B2 } = CefrLevel;`.

Set `CURRICULUM_VERSION_ES` to the implementation date (e.g. `'2026-07-06'`) and append to its doc comment:

```ts
 * `<DATE>`: ES A1/A2 restored and expanded to PCIC parity (21 A1 + 23 A2
 * grammar points, 10 vocab + 2 dictation + 6 free-writing umbrellas);
 * `es-b1-comparatives-superlatives` re-leveled to `es-a2-comparatives-superlatives`
 * per PCIC 2.5/6.1/15.3.8. Bump enumerates all new cells and clears any
 * suppression left from the 2026-05-10 reduction.
```

- [ ] **Step 2: Delete the dormant commented-out blocks**

Delete the entire `/* ... */` block containing the old A1/A2 grammar entries (the block from `// A1` through `es-a2-reflexive-verbs`) and the `/* ... */` block containing `es-a2-everyday-vocab`. New PCIC-grounded entries replace them in Tasks 2–8. Leave `// A1` / `// A2` section-header comments in place at the top of the array as insertion anchors:

```ts
  // ---------------------------------------------------------------------------
  // A1 (PCIC-aligned; Tasks 2–4)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // A2 (PCIC-aligned; Tasks 5–7)
  // ---------------------------------------------------------------------------
```

- [ ] **Step 3: Move + rewrite the comparatives entry as the LAST A2 entry**

Remove `es-b1-comparatives-superlatives` from the B1 section. Add under the A2 header (it stays the last A2 grammar entry as later tasks insert before it — final A2 order is fixed in Task 7's checklist):

```ts
  {
    key: 'es-a2-comparatives-superlatives',
    kind: 'grammar',
    name: 'Comparatives',
    description:
      'Comparisons of superiority, inferiority, and equality: más/menos ... que, tan ... como, tanto/a/os/as ... como, and the irregular comparatives mejor, peor, mayor, menor.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['Madrid es más grande que Sevilla.', 'Juan es tan alto como yo.'],
    examplesNegative: ['*Madrid es más grande de Sevilla.'],
    commonErrors: [
      'Using "de" instead of "que" in comparisons ("*más alto de mí").',
      'Saying "más bueno" instead of the suppletive form "mejor".',
      'Using "tan" before a noun where "tanto/a/os/as" is required ("*tan problemas como").',
    ],
  },
```

(The old B1 entry's `-ísimo` example `'Esta tarta está buenísima.'` is intentionally dropped — absolute superlative is not A2 in PCIC.)

- [ ] **Step 4: Lower the B1 minimum**

In `packages/db/src/curriculum/index.ts`, change `ES: { A1: 0, A2: 0, B1: 6, B2: 5 }` to `ES: { A1: 0, A2: 0, B1: 5, B2: 5 }` (A1/A2 raised in Task 9). In `curriculum.test.ts`, in the Spanish per-language-counts test: change `expect(grammar.B1).toBeGreaterThanOrEqual(6);` to `(5)`, and — because Tasks 2–8 add entries incrementally — relax the exact zero assertions to floors that stay green throughout the branch: `expect(grammar.A1).toBe(0)` → `expect(grammar.A1).toBeGreaterThanOrEqual(0)` and `expect(grammar.A2).toBe(0)` → `expect(grammar.A2).toBeGreaterThanOrEqual(1)` (the re-leveled comparatives). Task 9 tightens these to `≥ 21` / `≥ 23`.

- [ ] **Step 5: Rename the theory-category mapping**

In `packages/shared/src/theory-categories.ts` `KEY_TO_CATEGORY`, rename `'es-b1-comparatives-superlatives': 'syntax'` to `'es-a2-comparatives-superlatives': 'syntax'`. Mirror the same rename in `EXPECTED_KEY_CATEGORY` in `packages/shared/src/theory-categories.test.ts`. Also update the file-top comment in theory-categories.ts (drop the sentence saying ES A1/A2 are "intentionally absent for now" — Tasks 2–7 fill them in).

- [ ] **Step 6: Run tests**

Run: `pnpm build && pnpm --filter @language-drill/db test && pnpm --filter @language-drill/shared test`
Expected: PASS (invariants hold: comparatives key infix now matches cefrLevel A2; B1 count 5 ≥ 5).

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # must print feat/es-a1-a2-pcic-curriculum
git add packages/db/src/curriculum/es.ts packages/db/src/curriculum/index.ts packages/db/src/curriculum/curriculum.test.ts packages/shared/src/theory-categories.ts packages/shared/src/theory-categories.test.ts
git commit -m "feat(curriculum): scaffold ES A1/A2 restoration; re-level comparatives to A2 (PCIC)"
```

---

### Content-authoring template (Tasks 2–7)

Each content task appends `kind: 'grammar'` entries to es.ts in its listed order, using this shape (fields in this order, matching existing style):

```ts
  {
    key: 'es-a1-noun-gender',
    kind: 'grammar',
    name: 'Noun gender',
    description:
      'Noun gender: masculine -o / feminine -a, nouns in other vowels or consonants learned with their article, common exceptions (el problema, el día, la mano, la foto), and heteronym pairs (el padre / la madre).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['El problema es difícil.', 'Me duele la mano derecha.'],
    examplesNegative: ['*La problema es difícil.'],
    commonErrors: [
      'Treating every noun in -a as feminine ("*la problema", "*la día").',
      'Treating every noun in -o as masculine ("*el mano").',
      'Guessing the gender of nouns in -e or a consonant instead of learning it with the article.',
    ],
  },
```

The entry above is the finished Task 2 point 1 — copy it verbatim. For every other point: read the B&B chapter file(s) in the brief, then author `name`/`description`/`examplesPositive`/`examplesNegative`/`commonErrors` yourself so that (a) the description names the exact forms/contrasts in the brief's Scope column, (b) every Spanish sentence is verified against B&B, (c) commonErrors describe real L1-interference errors (B&B flags many explicitly). Add `prerequisiteKeys` / `coverageSpec` / `conjugationSuitable` ONLY where the brief's Flags column says so.

In the SAME task, add each point's theory-category mapping to `KEY_TO_CATEGORY` in `packages/shared/src/theory-categories.ts` (new `// --- Spanish (A1) ---` / `(A2)` sections) and mirror it in `EXPECTED_KEY_CATEGORY` in `theory-categories.test.ts`, using the brief's Category column.

Each task ends with:

Run: `pnpm build && pnpm --filter @language-drill/db test && pnpm --filter @language-drill/shared test`
Expected: PASS (invariants validate every new entry; counts are floors, not exact, until Task 9)

```bash
git branch --show-current   # must print feat/es-a1-a2-pcic-curriculum
git add packages/db/src/curriculum/es.ts packages/shared/src/theory-categories.ts packages/shared/src/theory-categories.test.ts
git commit -m "feat(curriculum): <task summary>"
```

---

### Task 2: A1 batch 1 — nouns, determiners, pronouns (8 points)

**Files:**
- Modify: `packages/db/src/curriculum/es.ts` (append under the A1 header)
- Modify: `packages/shared/src/theory-categories.ts`, `packages/shared/src/theory-categories.test.ts`

**Interfaces:**
- Consumes: A1 section anchor from Task 1.
- Produces: keys 1–8 below (Task 3's prerequisites reference none of them; Task 9 counts them).

| # | Key | Scope (PCIC ref) | B&B chapters | Category | Flags |
|---|---|---|---|---|---|
| 1 | `es-a1-noun-gender` | masc -o / fem -a; other vowels/consonants; exceptions el problema, el día, la mano, la foto; heteronyms (1.2) | `01-gender-of-nouns.md` | `articles` | — |
| 2 | `es-a1-noun-plural` | plural -s / -es; país→países (1.3) | `02-plural-of-nouns.md` | `morphology` | — |
| 3 | `es-a1-gender-agreement` | noun–adjective gender+number agreement; gentilicios (español/española, marroquí); postnominal position (2.2–2.4, 10.3) | `05-adjectives.md` | `articles` | — |
| 4 | `es-a1-articles` | el/la/los/las, un/una/unos/unas; contractions al/del; article with gustar-subject; no article after impersonal hay (3.1–3.3) | `03-the-definite-article.md`, `04-the-indefinite-article.md` | `articles` | — |
| 5 | `es-a1-demonstratives` | este/ese/aquel paradigms + esto/eso/aquello; near/far deixis; no co-occurrence with article (4) | `07-demonstrative-adjectives-and-pronouns.md` | `pronouns` | — |
| 6 | `es-a1-possessives-atonic` | mi/tu/su/nuestro/vuestro (+number/gender where applicable); prenominal only; no article; su ambiguity (5) | `09-possessive-adjectives-and-pronouns.md` | `pronouns` | — |
| 7 | `es-a1-subject-pronouns` | yo…ellos paradigm + usted/ustedes; pro-drop: omission as norm, presence for contrast (7.1.1) | `12-personal-pronouns-subject.md` | `pronouns` | — |
| 8 | `es-a1-interrogatives` | qué, quién, cuánto/-a/-os/-as, dónde, cómo, por qué; yes/no questions (7.3, 8.8, 8.9, 13.3) | `28-questions-and-exclamations.md` | `syntax` | — |

- [ ] Step 1: Read the B&B chapters listed above.
- [ ] Step 2: Append the 8 entries to es.ts in order (point 1 is verbatim from the template section).
- [ ] Step 3: Add the 8 theory-category mappings + test mirrors.
- [ ] Step 4: Run tests (template command). Expected: PASS.
- [ ] Step 5: Commit (`feat(curriculum): ES A1 batch 1 — nouns, determiners, pronouns`).

---

### Task 3: A1 batch 2 — verbs & quantity (8 points) + prerequisite restorations

**Files:**
- Modify: `packages/db/src/curriculum/es.ts`
- Modify: `packages/shared/src/theory-categories.ts`, `packages/shared/src/theory-categories.test.ts`

**Interfaces:**
- Consumes: A1 anchor; keys from Task 2 (no prereqs needed).
- Produces: `es-a1-present-indicative-regular` (Task 5 prereqs + B1 subjunctive prereq), `es-a1-ser-estar-basic` (B2 nuanced-ser-estar prereq).

| # | Key | Scope (PCIC ref) | B&B chapters | Category | Flags |
|---|---|---|---|---|---|
| 9 | `es-a1-present-indicative-regular` | -ar/-er/-ir present paradigms (9.1.1) | `16-forms-of-spanish-verbs.md`, `17-use-of-indicative-non-continuous-verb-tenses.md` | `tenses` | person coverageSpec + `conjugationSuitable: true` |
| 10 | `es-a1-present-irregular-core` | present of ser, estar, haber, ir (9.1.1) | `16-forms-of-spanish-verbs.md` | `tenses` | — |
| 11 | `es-a1-ser-estar-basic` | ser identity/class/origin/time vs estar location + bien/mal (12.1) | `33-ser-and-estar.md` | `pairs` | — |
| 12 | `es-a1-hay-estar` | impersonal hay vs está/están; hay+indefinite vs estar+definite (3.1, 3.3, 13.3) | `34-there-is-there-are-there-was-there-were-etc.md` | `pairs` | — |
| 13 | `es-a1-gustar-basic` | me/te gusta(n) + noun/infinitive; definite article on the subject noun (7.1.3, 12.1, 15.1.1) | `14-personal-pronouns-object.md` (search index.json for "gustar") | `syntax` | — |
| 14 | `es-a1-querer-poder-infinitive` | querer/poder + infinitive; infinitive as subject; creo que + indicative (15.1.1, 15.1.2) | `22-the-infinitive.md`, `25-auxiliary-verbs.md` | `syntax` | — |
| 15 | `es-a1-numbers-ordinals` | cardinals incl. gender variation (doscientas); ordinals to 10.º (6.1) | `11-numerals.md` | `morphology` | — |
| 16 | `es-a1-quantifiers-muy-mucho` | poco/mucho/bastante with agreement; muy vs mucho (6.1, 8.2) | `10-miscellaneous-adjectives-and-pronouns.md`, `35-adverbs.md` | `pairs` | — |

- [ ] Step 1: Read the B&B chapters.
- [ ] Step 2: Append the 8 entries (insert after Task 2's, before the A2 header).
- [ ] Step 3: Restore the two commented prerequisites on existing points: in `es-b1-present-subjunctive` replace the `// Restore when ...` comment with `prerequisiteKeys: ['es-a1-present-indicative-regular'],`; in `es-b2-nuanced-ser-estar` replace its `// Restore when ...` comment with `prerequisiteKeys: ['es-a1-ser-estar-basic'],`.
- [ ] Step 4: Add the 8 theory-category mappings + test mirrors.
- [ ] Step 5: Run tests. Expected: PASS (prereqs now resolve).
- [ ] Step 6: Commit (`feat(curriculum): ES A1 batch 2 — verbs and quantity; restore B1/B2 prereqs`).

---

### Task 4: A1 batch 3 — sentence & connectors (5 points)

**Files:** same trio as Task 2.

**Interfaces:**
- Produces: keys 17–21; completes the 21-point A1 set (Task 9 asserts `A1 ≥ 21`).

| # | Key | Scope (PCIC ref) | B&B chapters | Category | Flags |
|---|---|---|---|---|---|
| 17 | `es-a1-negation-tampoco` | no + verb; sí/no answers; también/tampoco polarity pairing (6.2, 8.2, 8.5) | `27-negation.md` | `syntax` | — |
| 18 | `es-a1-relative-que-basic` | restrictive que-relatives, subject/OD function, present indicative (7.2, 15.2) | `39-relative-clauses-and-relative-pronouns.md` | `syntax` | — |
| 19 | `es-a1-noun-modifiers-de` | el libro de español; possessive de (la página del libro); casa con jardín (10.2) | `38-prepositions.md` | `syntax` | — |
| 20 | `es-a1-coordination-basic` | y, ni, o, pero, uno…otro (14.1–14.4) | `37-conjunctions-and-discourse-markers.md` | `syntax` | — |
| 21 | `es-a1-porque-para` | porque + indicative; para + infinitive; por qué vs porque (15.3.4, 15.3.5) | `37-conjunctions-and-discourse-markers.md`, `38-prepositions.md` | `syntax` | — |

- [ ] Steps: read chapters → append 5 entries → add mappings + mirrors → run tests (PASS) → commit (`feat(curriculum): ES A1 batch 3 — sentence patterns and connectors`).

---

### Task 5: A2 batch 1 — tenses & verb forms (9 points) + B2 rescope

**Files:**
- Modify: `packages/db/src/curriculum/es.ts`
- Modify: `packages/shared/src/theory-categories.ts`, `packages/shared/src/theory-categories.test.ts`

**Interfaces:**
- Consumes: `es-a1-present-indicative-regular` (prerequisite target).
- Produces: `es-a2-preterite-regular` (prereq for preterite-irregular + imperfect), `es-a2-preterito-perfecto` (prereq target for `es-b2-compound-tenses`).

Insert BEFORE `es-a2-comparatives-superlatives` under the A2 header.

| # | Key | Scope (PCIC ref) | B&B chapters | Category | Flags |
|---|---|---|---|---|---|
| 1 | `es-a2-present-irregular-stem-changes` | e→ie, o→ue, e→i; saber/dar; orthographic changes (9.1.1 A2) | `16-forms-of-spanish-verbs.md` | `tenses` | person coverageSpec + `conjugationSuitable: true` |
| 2 | `es-a2-preterite-regular` | indefinido regular paradigms; punctual past; accent contrast hablo/habló (9.1.3) | `16-…`, `17-use-of-indicative-non-continuous-verb-tenses.md` | `tenses` | person coverageSpec + `conjugationSuitable: true`; `prerequisiteKeys: ['es-a1-present-indicative-regular']` |
| 3 | `es-a2-preterite-irregular` | tener/hacer/estar stems; ser/ir shared forms; ver/dar (9.1.3) | `16-…` | `tenses` | person coverageSpec + `conjugationSuitable: true`; `prerequisiteKeys: ['es-a2-preterite-regular']` |
| 4 | `es-a2-imperfect` | description + habit; ser/ir/ver; contrast with indefinido (9.1.2) | `17-…` (§ imperfect) | `tenses` | person coverageSpec + `conjugationSuitable: true`; `prerequisiteKeys: ['es-a2-preterite-regular']` |
| 5 | `es-a2-preterito-perfecto` | haber + participle; irregular participles (hecho, escrito, visto); markers ya/todavía no/hoy (9.1.6, 9.4.3) | `18-use-of-indicative-non-continuous-compound-tenses.md`, `23-participles.md` | `tenses` | person coverageSpec |
| 6 | `es-a2-imperative-affirmative` | tú/vosotros regular; di/haz/pon/sal; usted/ustedes; enclitics cómpralo (9.3) | `21-the-imperative.md` | `moods` | — |
| 7 | `es-a2-estar-gerundio` | gerund formation; estar + gerundio; enclitic on gerund (9.4.2, 12.1) | `19-continuous-forms-of-verbs.md`, `24-the-gerund.md` | `tenses` | — |
| 8 | `es-a2-ir-a-future` | ir a + infinitive; present with future value (9.1.1 A2, 12.1) | `17-…`, `25-auxiliary-verbs.md` | `tenses` | — |
| 9 | `es-a2-periphrases-obligation-aspect` | tener que, hay que, acabar de, empezar a, volver a, soler; clitic-position alternation (12.1) | `25-auxiliary-verbs.md` | `syntax` | — |

Fully worked point 2 (copy verbatim; pattern for the other starred tense points):

```ts
  {
    key: 'es-a2-preterite-regular',
    kind: 'grammar',
    name: 'Preterite — regular verbs',
    description:
      'Regular pretérito indefinido endings for -ar/-er/-ir verbs to narrate completed actions at a specific past time (ayer, el sábado). The stressed final vowel distinguishes it from the present (hablo / habló).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['Ayer hablé con mi madre.', 'Comimos en el parque el sábado.'],
    examplesNegative: ['*Ayer hablo con mi madre.'],
    commonErrors: [
      'Dropping the written accent that distinguishes preterite from present (hablo / habló).',
      'Mixing -er and -ir endings across persons.',
      'Using the preterite for habitual past actions where the imperfect is required.',
    ],
    prerequisiteKeys: ['es-a1-present-indicative-regular'],
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 } },
      ],
    },
    conjugationSuitable: true,
  },
```

- [ ] Step 1: Read the B&B chapters.
- [ ] Step 2: Append the 9 entries in order before the comparatives entry.
- [ ] Step 3: Rescope `es-b2-compound-tenses`: replace its `description` with

```ts
    description:
      'Perfect tenses beyond the pretérito perfecto: pluperfect (había terminado), future perfect (habré llegado), and conditional perfect groundwork — all formed with haber + invariable past participle.',
```

and add `prerequisiteKeys: ['es-a2-preterito-perfecto'],` (it currently has none).
- [ ] Step 4: Add the 9 theory-category mappings + test mirrors.
- [ ] Step 5: Run tests. Expected: PASS.
- [ ] Step 6: Commit (`feat(curriculum): ES A2 batch 1 — past tenses, imperative, periphrases; rescope B2 compound tenses`).

---

### Task 6: A2 batch 2 — pronouns (6 points)

**Files:** same trio.

**Interfaces:**
- Consumes: `es-a1-gustar-basic` (prereq target).
- Produces: keys 10–15.

Insert after Task 5's entries, before comparatives.

| # | Key | Scope (PCIC ref) | B&B chapters | Category | Flags |
|---|---|---|---|---|---|
| 10 | `es-a2-direct-object-pronouns` | lo/la/los/las + neuter lo; enclisis/proclisis; position in periphrases (7.1.2) | `14-personal-pronouns-object.md`, `15-le-les-and-lo-la-los-las.md` | `pronouns` | — |
| 11 | `es-a2-indirect-object-pronouns-se` | le/les; le→se before lo (se lo doy); clitic doubling; dative of possession (7.1.3, 12.2.3) | `14-…`, `15-…` | `pronouns` | — |
| 12 | `es-a2-tonic-pronouns-prepositions` | mí/ti; conmigo/contigo; "a mí me gusta" reduplication (7.1.6) | `13-personal-pronouns-used-with-prepositions.md` | `pronouns` | — |
| 13 | `es-a2-personal-a` | OD of person takes a; Lo vi / \*Vi a él (12.2.2) | `26-personal-a.md` | `syntax` | — |
| 14 | `es-a2-reflexive-verbs` | reflexive pronouns + daily-routine verbs; pronoun placement (7.1.4, 13.3) | `30-pronominal-verbs.md` | `pronouns` | — |
| 15 | `es-a2-gustar-type-verbs` | encantar, doler, interesar; plural agreement; a+tonic reduplication (7.1.3, 12.1, 12.2.3) | `14-…` (gustar-type section) | `syntax` | `prerequisiteKeys: ['es-a1-gustar-basic']` |

- [ ] Steps: read chapters → append 6 entries → add mappings + mirrors → run tests (PASS) → commit (`feat(curriculum): ES A2 batch 2 — object, tonic, and reflexive pronouns`).

---

### Task 7: A2 batch 3 — determiners & clauses (7 points)

**Files:** same trio.

**Interfaces:**
- Produces: keys 16–18 and 20–23; completes the 23-point A2 set (comparatives = 19).

Insert after Task 6's entries. Final A2 order check: entries 1–18, then 20–23, then `es-a2-comparatives-superlatives` last — OR move comparatives into slot 19; either is fine, the invariant suite does not care about intra-level order. Keep whichever needs the smaller diff.

| # | Key | Scope (PCIC ref) | B&B chapters | Category | Flags |
|---|---|---|---|---|---|
| 16 | `es-a2-articles-use` | anaphoric/generic article; el + tonic a (el aula); inalienable possession (me duele la cabeza); bare nouns (bebe agua); Es profesora (3.1–3.3, 5) | `03-the-definite-article.md`, `04-the-indefinite-article.md` | `articles` | — |
| 17 | `es-a2-possessives-tonic` | mío/tuyo/suyo; el mío; "Es mío" (5) | `09-possessive-adjectives-and-pronouns.md` | `pronouns` | — |
| 18 | `es-a2-todo-otro-quantifiers` | todo + obligatory determiner; otro (no "un otro"); demasiado; nada/nadie (6.1) | `10-miscellaneous-adjectives-and-pronouns.md` | `syntax` | — |
| 20 | `es-a2-temporal-clauses` | cuando + present (habitual); antes de / después de + infinitive; desde / desde que / desde hace; hasta; ¿cuándo? (15.3.1, 8.2, 8.8) | `36-expressions-of-time.md`, `38-prepositions.md` | `syntax` | — |
| 21 | `es-a2-si-present-conditional` | si + present, present/imperative apodosis; si vs sí (15.3.6) | `29-conditional-sentences.md` | `moods` | — |
| 22 | `es-a2-exclamatives-impersonals` | ¡Qué + adj/adv!; exhortatives; impersonal hace (weather); estamos a X grados (7.4, 11.2, 13.3, 12.1) | `28-questions-and-exclamations.md`, `34-there-is-there-are-there-was-there-were-etc.md` | `syntax` | — |
| 23 | `es-a2-connectors` | e for y, u for o; por eso, entonces (14.1, 14.2, 15.3.7) | `37-conjunctions-and-discourse-markers.md` | `syntax` | — |

- [ ] Steps: read chapters → append 7 entries → add mappings + mirrors → run tests (PASS) → commit (`feat(curriculum): ES A2 batch 3 — determiners, clauses, connectors`).

---

### Task 8: Vocab, dictation, and free-writing umbrellas (18 entries)

**Files:**
- Modify: `packages/db/src/curriculum/es.ts`
- Modify: `packages/db/src/curriculum/curriculum.test.ts`

**Interfaces:**
- Produces: umbrella keys below; `es-a2-vocab-time-daily-routine` is Task 9's seed-map target.

- [ ] **Step 1: Update the count assertions FIRST (red)**

In the Spanish per-language-counts test: `vocab` `toBe(2)` → `toBe(12)`; `dictation` `toBe(2)` → `toBe(4)`; `freeWriting` `toBe(12)` → `toBe(18)`; update the test title accordingly. In the free-writing describe block, extend the ES test to also assert 3 A1 + 3 A2 (mirror the TR test's shape):

```ts
  it('has 3 free-writing topic umbrellas per ES A1 and A2, and 6 per B1 and B2', () => {
    const fw = esCurriculum.filter((e) => e.kind === 'free-writing');
    expect(fw.filter((e) => e.cefrLevel === 'A1')).toHaveLength(3);
    expect(fw.filter((e) => e.cefrLevel === 'A2')).toHaveLength(3);
    expect(fw.filter((e) => e.cefrLevel === 'B1')).toHaveLength(6);
    expect(fw.filter((e) => e.cefrLevel === 'B2')).toHaveLength(6);
    for (const e of fw) {
      expect(e.freeWriting?.register).toBeDefined();
    }
  });
```

Run: `pnpm --filter @language-drill/db test` → Expected: FAIL (counts short).

- [ ] **Step 2: Add 10 vocab umbrellas** (before the existing ES B1 vocab entry, keeping level order). Keys and themes — A1: `es-a1-vocab-family-people`, `es-a1-vocab-food-drink`, `es-a1-vocab-home-objects`, `es-a1-vocab-city-places`, `es-a1-vocab-weather-clothing`; A2: `es-a2-vocab-work-school`, `es-a2-vocab-city-shopping`, `es-a2-vocab-health-body`, `es-a2-vocab-travel-nature`, `es-a2-vocab-time-daily-routine`. Model each on the TR themed umbrellas (tr.ts) — worked example:

```ts
  {
    key: 'es-a1-vocab-family-people',
    kind: 'vocab',
    name: 'Family and people (A1)',
    description:
      'Core A1 vocabulary for family members, people, and basic personal descriptions.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['la madre', 'el hermano mayor'],
    examplesNegative: ['*el madre'],
    commonErrors: [
      'Mismatching article gender on family nouns ("*el madre").',
      'Confusing "padres" (parents) with "parientes" (relatives).',
    ],
  },
```

- [ ] **Step 3: Add 2 dictation umbrellas** (`es-a1-dictation`, `es-a2-dictation`, before `es-b1-dictation`), modeled on the ES B1/B2 dictation entries but level-appropriate (A1: 1–2 short simple sentences, slow pace; A2: 2–3 sentences with past tenses), each with `targetOverride: 30` (matches TR dictation practice). Worked example:

```ts
  {
    key: 'es-a1-dictation',
    kind: 'dictation',
    name: 'Dictation — connected speech (A1)',
    description:
      'Short, slow A1 connected-speech clips (1–2 simple sentences) on everyday topics; tests basic word segmentation, silent h, and b/v spelling traps at beginner pace.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'Me llamo Ana y vivo en Madrid.',
      'Hoy es lunes y tengo clase de español.',
    ],
    examplesNegative: ['*Una lista de palabras sueltas sin oración natural.'],
    commonErrors: [
      'Adding or dropping the silent h (hoy / *oy).',
      'Confusing b and v in common words (vivo / *bibo).',
    ],
    targetOverride: 30,
  },
```

- [ ] **Step 4: Add 6 free-writing umbrellas** (before the ES B1 free-writing entries): A1 `es-a1-fw-my-family` (*Mi familia*, informal), `es-a1-fw-my-home` (*Mi casa*, neutral), `es-a1-fw-a-day` (*Un día de mi semana*, neutral); A2 `es-a2-fw-last-vacation` (*Mis últimas vacaciones*, neutral — deliberately exercises the new past tenses), `es-a2-fw-best-friend` (*Mi mejor amigo/a*, informal), `es-a2-fw-my-neighborhood` (*Mi barrio*, neutral). Model on the ES B1 free-writing entries (concrete checklist in examplesPositive). Worked example:

```ts
  {
    key: 'es-a1-fw-my-family',
    kind: 'free-writing',
    name: 'Mi familia',
    description:
      'An informal prompt to introduce your family: who they are and one detail about each person.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'Asks the learner to name two family members and say one thing about each.',
      'Requires a closing sentence about who they see most often.',
    ],
    examplesNegative: ['*Write about family in general.'],
    commonErrors: ['Unscoped prompt with no concrete checklist.'],
    freeWriting: { register: 'informal' },
  },
```

- [ ] **Step 5: Run tests** — `pnpm --filter @language-drill/db test` → Expected: PASS (green).
- [ ] **Step 6: Commit** (`feat(curriculum): ES A1/A2 vocab, dictation, and free-writing umbrellas`).

---

### Task 9: Lock counts, restore seed map, clean comments

**Files:**
- Modify: `packages/db/src/curriculum/index.ts`
- Modify: `packages/db/src/curriculum/curriculum.test.ts`
- Modify: `packages/db/scripts/seed-exercises.ts`
- Modify: `packages/db/scripts/seed-exercises.test.ts`

**Interfaces:**
- Consumes: all keys from Tasks 2–8.
- Produces: enforced minimums `{ A1: 21, A2: 23, B1: 5, B2: 5 }`.

- [ ] **Step 1: Raise the minimums.** In `index.ts`: `ES: { A1: 21, A2: 23, B1: 5, B2: 5 }`. Replace the "ES/DE are still TEMPORARILY REDUCED" comment with one noting only DE remains reduced.
- [ ] **Step 2: Tighten the Spanish counts test.** `grammar.A1` → `toBeGreaterThanOrEqual(21)`, `grammar.A2` → `toBeGreaterThanOrEqual(23)`, keep B1/B2 `≥ 5`; retitle the test (`'Spanish is at full PCIC A1+A2 parity …'`). Update the stale block comment above the describe (lines about the 2026-05-10 reduction).
- [ ] **Step 3: Restore the seed map.** In `seed-exercises.ts` `SEED_KEY_TO_GRAMMAR_POINT`, uncomment and set:

```ts
  'es-cloze-a2-1': 'es-a2-preterite-irregular',
  'es-translation-a2-1': 'es-a2-gustar-type-verbs',
  'es-vocab-a2-1': 'es-a2-vocab-time-daily-routine',
```

(`es-vocab-a2-1` is the "desayuno" seed — daily-routine theme; the old `es-a2-everyday-vocab` umbrella no longer exists.) Update the comment above the map.
- [ ] **Step 4: Update the seed test.** In `seed-exercises.test.ts`: `toHaveLength(9)` → `toHaveLength(12)`; check the `untaggedEnSeeds`/tags assertions still hold (they count from the map, so `result.tags` length follows automatically); update the "temporarily reduced" comment.
- [ ] **Step 5: Run tests.** `pnpm build && pnpm --filter @language-drill/db test` → Expected: PASS.
- [ ] **Step 6: Commit** (`feat(curriculum): enforce ES A1/A2 minimums; restore ES seed grammar-point map`).

---

### Task 10: Data migration for the comparatives re-level

**Files:**
- Create: `packages/db/migrations/0034_<generated-name>.sql` (via drizzle-kit `--custom`)
- Modify: `packages/db/migrations/meta/_journal.json` (generated)

**Interfaces:**
- Consumes: key rename decided in Task 1.
- Produces: prod/dev data rows re-pointed to `es-a2-comparatives-superlatives`.

- [ ] **Step 1: Generate an empty custom migration**

Run from the worktree root: `pnpm --filter @language-drill/db exec drizzle-kit generate --custom --name=es_comparatives_relevel`
Expected: a new empty `packages/db/migrations/0034_es_comparatives_relevel.sql` + journal entry. (If `main` gained migrations meanwhile, follow the renumber recipe: take main's `migrations/meta`, `git rm` the stale file, regenerate.)

- [ ] **Step 2: Write the DML** (paste exactly):

```sql
-- Re-level es-b1-comparatives-superlatives -> es-a2-comparatives-superlatives
-- (PCIC alignment; see docs/superpowers/specs/2026-07-06-es-a1-a2-pcic-curriculum-design.md).
-- Pure forward-only DML; no-op on databases without the old key.
UPDATE "exercises" SET "grammar_point_key" = 'es-a2-comparatives-superlatives', "difficulty" = 'A2' WHERE "grammar_point_key" = 'es-b1-comparatives-superlatives';--> statement-breakpoint
UPDATE "user_grammar_mastery" SET "grammar_point_key" = 'es-a2-comparatives-superlatives' WHERE "grammar_point_key" = 'es-b1-comparatives-superlatives';--> statement-breakpoint
UPDATE "theory_topics" SET "grammar_point_key" = 'es-a2-comparatives-superlatives' WHERE "grammar_point_key" = 'es-b1-comparatives-superlatives';--> statement-breakpoint
UPDATE "error_observations" SET "host_grammar_point_key" = 'es-a2-comparatives-superlatives' WHERE "host_grammar_point_key" = 'es-b1-comparatives-superlatives';--> statement-breakpoint
UPDATE "error_observations" SET "error_grammar_point_key" = 'es-a2-comparatives-superlatives' WHERE "error_grammar_point_key" = 'es-b1-comparatives-superlatives';--> statement-breakpoint
UPDATE "fluency_attempts" SET "grammar_point_key" = 'es-a2-comparatives-superlatives' WHERE "grammar_point_key" = 'es-b1-comparatives-superlatives';--> statement-breakpoint
UPDATE "spaced_repetition_cards" SET "item_id" = 'es-a2-comparatives-superlatives' WHERE "item_type" = 'grammar_point' AND "item_id" = 'es-b1-comparatives-superlatives';
```

Notes recorded during planning (no action needed, context for the reviewer):
- The exercises UPDATE changes `grammar_point_key` AND `difficulty` together so the `(language, difficulty, type, grammarPointKey, expr)` dedup index stays unique and the scheduler — which groups approved counts by exactly `(language, difficulty, type, grammar_point_key)` (`infra/lambda/src/generation/scheduler.ts:154-165`) — sees the migrated pool under the new A2 cell and does not regenerate it.
- `user_grammar_mastery`'s PK `(user_id, grammar_point_key)` cannot collide: the new key never existed before this branch.
- `generation_jobs` history rows are intentionally untouched; `user_exercise_history` has no grammar-key column.
- Do NOT apply this to the shared Neon `dev` branch by hand (per-PR CI forks inherit dev's state); CI will apply it on the PR's ephemeral branch.

- [ ] **Step 3: Sanity-check SQL locally** — the migration is pure DML, so just verify drizzle accepts the file: `pnpm --filter @language-drill/db test` (migration files are not executed by tests; this catches accidental journal corruption via the schema tests) and eyeball `_journal.json` has exactly one new entry.
- [ ] **Step 4: Commit** (`feat(db): migrate comparatives grammar-point key B1→A2 across data tables`).

---

### Task 11: Full gates, push, PR

- [ ] **Step 1: Clean stale artifacts** — `rm -rf infra/lambda/dist` (known phantom-failure source).
- [ ] **Step 2: Full suite from worktree root** — `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures. (If infra CDK-synth tests fail with esbuild bundling errors, that is the known local-environment issue — verify esbuild is symlinked at root before concluding anything.)
- [ ] **Step 3: Push and open the PR** (use the `ghp` alias; squash-merge is the repo default):

```bash
git push -u origin feat/es-a1-a2-pcic-curriculum
ghp pr create --title "feat(curriculum): ES A1/A2 restored at full PCIC parity" --body "$(cat <<'EOF'
Restores the ES A1/A2 curriculum (disabled 2026-05-10) at full Plan Curricular
del Instituto Cervantes alignment:

- 21 A1 + 23 A2 grammar points (PCIC-placed, Butt & Benjamin-grounded)
- 10 themed vocab umbrellas, 2 dictation umbrellas (target 30), 6 free-writing topics
- es-b1-comparatives-superlatives re-leveled to A2 (PCIC 2.5/6.1/15.3.8) with a
  forward-only data migration across exercises / mastery / theory / error /
  fluency / SRS tables
- es-b2-compound-tenses rescoped (present perfect now at A2); prerequisites restored
- CURRICULUM_VERSION_ES bumped; ES minimums enforced at { A1: 21, A2: 23, B1: 5, B2: 5 }

Spec: docs/superpowers/specs/2026-07-06-es-a1-a2-pcic-curriculum-design.md

Post-merge (operator checklist):
1. Nothing to push to Langfuse (no prompt edits).
2. Scheduler enumerates the ~55 new cells at the next ~04:00 UTC run; the global
   budget cap paces pool-filling over several nights.
3. Run the theory batch generation for the new ES A1/A2 grammar points.
4. Spot-check per-cell approval rates on the admin pool page after the first run.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Stop.** Post-merge operational steps (theory generation, first-run spot-check) are for the operator after review + merge — do not run them from this branch.

---

## Self-review notes

- **Spec coverage:** every spec section maps to a task — A1 inventory (2–4), A2 inventory + B1/B2 adjustments (1, 5–7), umbrellas (8), mechanics (1, 9, 10), rollout (11). The spec's migration-table list was corrected during planning (fluency_attempts / error_observations / spaced_repetition_cards; user_exercise_history has no key column) — spec updated in the same commit as this plan.
- **Ordering constraint verified:** no task's `prerequisiteKeys` reference a key authored in a later task (B1-subjunctive/B2-ser-estar prereqs restored in Task 3 after their targets exist; B2-compound-tenses prereq added in Task 5 alongside `es-a2-preterito-perfecto`).
- **Type consistency:** all cross-task references use exact keys; coverageSpec floors `{1sg,2sg,3sg,1pl,3pl: 5}` match the legal `COVERAGE_AXIS_VALUES` person values; `targetOverride: 30` matches TR dictation practice.
