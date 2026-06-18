# TR B1 Curriculum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Turkish B1 to the curriculum (10 grammar points + 5 vocab + 1 dictation + 3 free-writing), enable it for generation, then generate the theory + exercise pools.

**Architecture:** Curriculum is static data in `packages/db/src/curriculum/tr.ts`, validated by `assertCurriculumInvariants` (`index.ts`) and `curriculum.test.ts`. B1 cells are authored fresh from the Yedi İklim B1 syllabus, grounded author-time in Göksel & Kerslake, _Turkish: A Comprehensive Grammar_ (`/Users/seal/dev/turkish-grammar-book/turkish-grammar-md`, anchors cited per point). Enabling = raise the B1 grammar floor + bump `CURRICULUM_VERSION_TR`. Generation is operational (theory CLI + scheduler/on-demand trigger), done post-merge.

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Vitest, Drizzle (Neon).

**Design spec:** `docs/superpowers/specs/2026-06-19-tr-b1-curriculum-design.md`

---

## Conventions for every authoring task

- `tr.ts` top already has `const TR = Language.TR;`. **Task 1 adds `B1`** to the
  CefrLevel destructure: `const { A1, A2, B1 } = CefrLevel;`.
- Each grammar object's field order mirrors existing entries: optional flags +
  `coverageSpec` first, then `kind`, `name`, `description` (≤200 chars),
  `cefrLevel`, `language`, `examplesPositive` (≥2), `examplesNegative` (≥1, each
  starting `*`), `commonErrors` (≥1), `prerequisiteKeys?`.
- **G&K grounding (author-time):** before finalizing each point, open the cited
  section(s) and confirm the morphology/examples. Record the anchors as a
  `// G&K §…` comment above the object. The drafted objects below are
  ready-to-use; adjust only if G&K contradicts a detail.
- **Legal coverage axes:** `person` (`1sg 2sg 3sg 1pl 2pl 3pl`), `polarity`
  (`affirmative negative`), `sentenceType`, `wordClass` (vocab only). There is
  **no** `tense`/`mood` axis — encode tense/mood variety through examples, not a
  spec axis. Any point flagged `conjugationSuitable` **must** carry a `person`
  axis (enforced by `curriculum.test.ts`).
- **Per-point test command** (fast inner loop, threshold still 0 so it passes):
  ```bash
  pnpm --filter @language-drill/db build && \
  pnpm --filter @language-drill/db test -- -t "assertCurriculumInvariants"
  ```
  The `build` is required — single-package vitest resolves against `db/dist`
  (stale-dist gotcha). The aggregate `per-language counts` test stays red until
  Task 14 (counts not reached yet); do **not** run it per-point.
- Insert B1 grammar points in the array in the order below (Tasks 2–11),
  immediately after the last A2 grammar entry and before the vocab umbrellas.

---

## Task 1: Prep tr.ts — destructure, remove drafts, version bump

**Files:**
- Modify: `packages/db/src/curriculum/tr.ts`

- [ ] **Step 1: Add `B1` to the CefrLevel destructure**

Change `const { A1, A2 } = CefrLevel;` to:
```ts
const { A1, A2, B1 } = CefrLevel;
```

- [ ] **Step 2: Delete the commented B1/B2 draft blocks**

Remove the `/* … */` block at ~`tr.ts:1214–1356` (the B1/B2 grammar drafts) and
the `/* … */` block at ~`tr.ts:1682–1713` (the B1/B2 vocab drafts). Replace the
first with a section header only:
```ts
  // ===========================================================================
  // B1 — authored fresh from Yedi İklim B1, grounded in Göksel & Kerslake.
  // (B2 is a separate later cycle.)
  // ===========================================================================
```
Leave A1/A2 entries untouched. (B2 will be authored in its own cycle; no B2
draft is retained.)

- [ ] **Step 3: Bump the curriculum version**

Change `export const CURRICULUM_VERSION_TR = '2026-06-17';` to:
```ts
export const CURRICULUM_VERSION_TR = '2026-06-19';
```
Add a one-line changelog comment in the header block:
```ts
 * 2026-06-19: TR B1 enabled — 10 grammar + 5 vocab + dictation + 3 free-writing
 * (Yedi İklim B1, G&K-grounded). Bump clears low-yield/saturation suppression.
```

- [ ] **Step 4: Verify build + invariants still pass (no B1 points yet)**

```bash
pnpm --filter @language-drill/db build && \
pnpm --filter @language-drill/db test -- -t "assertCurriculumInvariants"
```
Expected: PASS (threshold TR.B1 still 0; no new points).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/curriculum/tr.ts
git commit -m "chore(curriculum): scaffold TR B1 section, drop stale drafts, bump version"
```

---

## Task 2: `tr-b1-past-continuous-iyordu`

**Files:** Modify `packages/db/src/curriculum/tr.ts` (insert in B1 section)

- [ ] **Step 1: Add the grammar point**

```ts
  // G&K §21.3.1–.2 (imperfective: progressive + habitual), §21.2.1 (past)
  {
    key: 'tr-b1-past-continuous-iyordu',
    conjugationSuitable: true,
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
        { name: 'polarity', floors: { affirmative: 18, negative: 12 } },
      ],
    },
    kind: 'grammar',
    name: 'Past continuous -(I)yordu',
    description:
      'Past imperfective -(I)yor + copular -DI: an ongoing or habitual past ("was …ing", "used to"). The -(I)yor buffer/voicing rules carry over; -DI takes harmonised personal endings.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Eve geliyordum. (I was coming home.)',
      'Her sabah erken kalkıyordu. (He used to get up early — habitual.)',
      'Biz yemek yiyorduk. (We were eating.)',
      "Sen Ömer'i benden iyi tanıyordun. (You knew Ömer better — stative.)",
    ],
    examplesNegative: [
      '*Geliyordüm. (wrong — the copular past harmonises to -du after o/u: geliyordum)',
      '*Geldiyordum. (wrong — base is the -(I)yor stem, not the -DI past: geliyordum)',
    ],
    commonErrors: [
      'Using completed -DI where ongoing/habitual -(I)yordu is meant (geldim vs geliyordum).',
      'Wrong vowel harmony on the -DI copula (geliyordüm instead of geliyordum).',
      'Stacking two past markers (*geldiyordum).',
    ],
    prerequisiteKeys: ['tr-a1-present-continuous', 'tr-a1-dili-past'],
  },
```

- [ ] **Step 2: Build + invariants**
```bash
pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- -t "assertCurriculumInvariants"
```
Expected: PASS.

- [ ] **Step 3: Commit**
```bash
git add packages/db/src/curriculum/tr.ts
git commit -m "feat(curriculum): TR B1 past continuous -(I)yordu"
```

---

## Task 3: `tr-b1-conditional-irrealis`

**Files:** Modify `packages/db/src/curriculum/tr.ts`

- [ ] **Step 1: Add the grammar point**

```ts
  // G&K Ch 27 (§27.1.1 -sA/-(y)sA, §27.2.3 -sA, §27.2.4 -sAydI), wishes §21.4.4.1
  {
    key: 'tr-b1-conditional-irrealis',
    // sentenceConstructionSuitable intentionally OFF: -sA (wish), -sAydI
    // (counterfactual) and copular -(y)sA (real conditional) are three distinct
    // constructions, so a free-production prompt is structurally ambiguous —
    // same reasoning as tr-a2-reported-speech. Covered by cloze/translation.
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
        { name: 'polarity', floors: { affirmative: 18, negative: 12 } },
      ],
    },
    kind: 'grammar',
    name: 'Conditional & wish -sA / -sAydI / -(y)sA',
    description:
      'Verbal -sA (wish/hypothetical), -sAydI (past counterfactual), and copular -(y)sA ("if it is", real condition). "Keşke" + -sA(ydI) marks wishes and regrets.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Keşke burada olsa. (If only he were here — present wish.)',
      'Vaktim olsaydı, gelirdim. (If I had had time, I would have come — counterfactual.)',
      'Hava güzelse yürüyelim. (If the weather is nice, let us walk — real condition, copular -(y)sA.)',
      'Param olsa, bir ev alırdım. (If I had money, I would buy a house.)',
    ],
    examplesNegative: [
      '*Vaktim olsa, geldim. (wrong — counterfactual needs -sAydI + aorist-past main clause: olsaydı, gelirdim)',
      '*Hava güzel olursa yürüdük. (wrong — a real condition pairs -(y)sA/aorist with a non-past main clause)',
    ],
    commonErrors: [
      'Pairing a -sA wish with the wrong main-clause tense.',
      'Using real-conditional -(y)sA where past counterfactual -sAydI is required.',
      'Dropping "keşke" so a regret reads as a neutral condition.',
    ],
    prerequisiteKeys: ['tr-a1-dili-past'],
  },
```

- [ ] **Step 2: Build + invariants** — `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- -t "assertCurriculumInvariants"` → PASS
- [ ] **Step 3: Commit** — `git commit -am "feat(curriculum): TR B1 conditional & wish -sA/-sAydI/-(y)sA"`

---

## Task 4: `tr-b1-obligation-periphrases`

**Files:** Modify `packages/db/src/curriculum/tr.ts`

- [ ] **Step 1: Add the grammar point**

```ts
  // G&K §21.4.2.2 (necessity/obligation): -mAlI is speaker-felt (A2); the
  // lexical periphrases below are objective obligation. Note the nominalization
  // split: zorunda takes -mAk; gerek/lazım/şart take -mA + possessive.
  {
    key: 'tr-b1-obligation-periphrases',
    conjugationSuitable: true,
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
        { name: 'polarity', floors: { affirmative: 18, negative: 12 } },
      ],
    },
    kind: 'grammar',
    name: 'Obligation -mAk zorunda / gerek / lazım / şart',
    description:
      'Objective obligation by lexical means (vs speaker-felt -mAlI at A2): -mAk zorunda(yım) (compulsion), -mAm gerek/lazım/şart, gerek-iyor. zorunda/şart are stronger; gerek/lazım milder.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      "Ankara'ya gitmek zorundayım. (I have to go to Ankara — external compulsion.)",
      'Şimdi gitmem lazım. (I need to go now.)',
      'Bunu bitirmemiz gerekiyor. (We need to finish this.)',
      'Daha çok çalışman şart. (It is essential that you work more.)',
    ],
    examplesNegative: [
      '*Gitmem zorunda. (wrong — zorunda takes the bare -mAk infinitive: gitmek zorundayım)',
      '*Gitmek lazım benim. (wrong — gerek/lazım take -mA + possessive: gitmem lazım)',
    ],
    commonErrors: [
      'Using speaker-felt -mAlI where external obligation calls for zorunda.',
      'Wrong nominalization: -mAk for zorunda vs -mA+possessive for gerek/lazım/şart.',
      'Dropping the locative/personal ending on zorunda (gitmek zorunda instead of …zorundayım).',
    ],
    prerequisiteKeys: ['tr-a2-ability-necessity'],
  },
```

- [ ] **Step 2: Build + invariants** → PASS
- [ ] **Step 3: Commit** — `git commit -am "feat(curriculum): TR B1 obligation periphrases"`

---

## Task 5: `tr-b1-causative-voice`

**Files:** Modify `packages/db/src/curriculum/tr.ts`

- [ ] **Step 1: Add the grammar point**

```ts
  // G&K §8.2.1.1 (allomorphy), §13.2.1 (causative constructions)
  {
    key: 'tr-b1-causative-voice',
    conjugationSuitable: true,
    sentenceConstructionSuitable: true,
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
        { name: 'polarity', floors: { affirmative: 18, negative: 12 } },
      ],
    },
    kind: 'grammar',
    name: 'Causative -DIr / -t / -Ir / -Ar',
    description:
      'Adds a causer. Allomorphy: polysyllabic / vowel-, l-, r-final stems take -t (kapat-, uyut-); ~30 monosyllables take -Ir/-Ar/-It (düşür-, çıkar-, korkut-); elsewhere -DIr (yaptır-, öldür-). Stackable.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Müdür raporu bana yazdırdı. (The manager had me write the report — yaz → yazdır.)',
      'Çocuğu uyuttum. (I put the child to sleep — uyu → uyut.)',
      'Suyu kaynattım. (I boiled the water — kayna → kaynat.)',
      'Onu güldürdün. (You made him laugh — gül → güldür.)',
    ],
    examplesNegative: [
      '*yaztır- (wrong allomorph — consonant-final yaz takes -DIr: yazdır-)',
      '*uyudur- (wrong — vowel-final uyu takes -t: uyut-)',
    ],
    commonErrors: [
      'Picking -DIr where the stem requires -t / -Ir / -Ar.',
      'Forgetting the causee marking (-A dative for the demoted agent).',
      'Over-generating causatives on verbs with suppletive transitives (gir- → sok-, not *girdir-).',
    ],
  },
```

- [ ] **Step 2: Build + invariants** → PASS
- [ ] **Step 3: Commit** — `git commit -am "feat(curriculum): TR B1 causative voice"`

---

## Task 6: `tr-b1-passive-voice`

**Files:** Modify `packages/db/src/curriculum/tr.ts`

- [ ] **Step 1: Add the grammar point** (NOT conjugationSuitable — impersonal/3rd-person-dominant, G&K §13.2.2.3; relies on default polarity + sentenceType monitoring, no coverageSpec)

```ts
  // G&K §8.2.1.2 (allomorphy), §13.2.2 (passive + impersonal passives)
  {
    key: 'tr-b1-passive-voice',
    sentenceConstructionSuitable: true,
    kind: 'grammar',
    name: 'Passive -Il / -In / -n',
    description:
      'Passive demotes the subject. Allomorphy: -Il after most consonants (yapıl-, görül-), -In after l-final stems (bilin-, alın-), -n after vowels (aran-, okun-). Agent optional with "tarafından"; impersonal passive on intransitives (gidilir).',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      "Bu ev 1950'de yapıldı. (This house was built in 1950.)",
      'Mektup dün yazıldı. (The letter was written yesterday.)',
      'Hırsız polis tarafından yakalandı. (The thief was caught by the police.)',
      'Burada sigara içilmez. (Smoking is not done here — impersonal passive.)',
    ],
    examplesNegative: [
      '*yapınıl- (wrong — consonant-final yap takes -Il: yapıl-)',
      '*aranıl- for "be searched" (wrong — vowel-final ara takes -n: aran-)',
    ],
    commonErrors: [
      'Wrong allomorph (-Il vs -In vs -n).',
      'Expressing the agent with -DAn instead of "tarafından".',
      'Confusing the reflexive/passive homophone (yıkan- = "be washed" or "bathe").',
    ],
  },
```

- [ ] **Step 2: Build + invariants** → PASS
- [ ] **Step 3: Commit** — `git commit -am "feat(curriculum): TR B1 passive voice"`

---

## Task 7: `tr-b1-reflexive-voice-kendi`

**Files:** Modify `packages/db/src/curriculum/tr.ts`

- [ ] **Step 1: Add the grammar point** (unproductive closed set — G&K §8.2.1.3; SC ON over a curated verb list; no coverageSpec)

```ts
  // G&K §8.2.1.3 (reflexive -(I)n is unproductive: closed set), §13.2.3.1,
  // kendi §18.1.2.2. Productive "self" usually = kendi + plain verb.
  {
    key: 'tr-b1-reflexive-voice-kendi',
    sentenceConstructionSuitable: true,
    kind: 'grammar',
    name: 'Reflexive -(I)n & the pronoun "kendi"',
    description:
      'Unproductive reflexive -(I)n on a closed set (yıkan- bathe, giyin- get dressed, taran- comb one’s hair, örtün- cover oneself); the pronoun "kendi(m/n/si)" for reflexive/emphatic "self" (kendimi gördüm; bunu kendin yaptın).',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Her sabah yıkanıyorum. (I bathe every morning.)',
      'Çabuk giyindi. (He got dressed quickly.)',
      'Kendimi aynada gördüm. (I saw myself in the mirror.)',
      'Bunu kendin yaptın. (You did this yourself — emphatic.)',
    ],
    examplesNegative: [
      '*Kendimi yıkanıyorum. (wrong — the reflexive verb already means "self"; don’t add kendimi: yıkanıyorum)',
      '*Elbiseyi giyindim. (wrong — reflexive giyin- is intransitive; "put on a garment" is giy-: elbiseyi giydim)',
    ],
    commonErrors: [
      'Treating -(I)n as productive (most reflexive senses use kendi + plain verb).',
      'Doubling a reflexive verb with kendi.',
      'Confusing transitive giy- with intransitive giyin-.',
    ],
  },
```

- [ ] **Step 2: Build + invariants** → PASS
- [ ] **Step 3: Commit** — `git commit -am "feat(curriculum): TR B1 reflexive voice & kendi"`

---

## Task 8: `tr-b1-reciprocal-voice`

**Files:** Modify `packages/db/src/curriculum/tr.ts`

- [ ] **Step 1: Add the grammar point** (unproductive closed set — G&K §8.2.1.4; SC ON over a curated verb list; no coverageSpec)

```ts
  // G&K §8.2.1.4 (reciprocal -(I)ş is unproductive: closed set), §13.2.3.2,
  // birbir- §18.1.4. Productive reciprocity = birbiri + plain verb.
  {
    key: 'tr-b1-reciprocal-voice',
    sentenceConstructionSuitable: true,
    kind: 'grammar',
    name: 'Reciprocal -(I)ş & "birbiri"',
    description:
      'Unproductive reciprocal -(I)ş on a closed set (öpüş- kiss each other, görüş- meet, dövüş- fight, selamlaş- greet); "birbiri(ni/yle)" "each other" expresses reciprocity productively.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Kapıda öpüştüler. (They kissed each other at the door.)',
      'Yarın görüşürüz. (We will see each other tomorrow.)',
      'Birbirimize yardım ettik. (We helped each other.)',
      'Mektuplaştılar. (They corresponded with each other.)',
    ],
    examplesNegative: [
      '*Birbirini öpüştüler. (wrong — -(I)ş already encodes "each other"; don’t add birbirini: öpüştüler)',
      '*Onunla konuştuk birbirimizle. (wrong — konuş- is lexicalized "speak", not a reciprocal of a base verb)',
    ],
    commonErrors: [
      'Treating -(I)ş as productive.',
      'Doubling a reciprocal verb with birbiri.',
      'Wrong case on birbiri (birbirine / birbiriyle / birbirini).',
    ],
  },
```

- [ ] **Step 2: Build + invariants** → PASS
- [ ] **Step 3: Commit** — `git commit -am "feat(curriculum): TR B1 reciprocal voice & birbiri"`

---

## Task 9: `tr-b1-converb-while-yken`

**Files:** Modify `packages/db/src/curriculum/tr.ts`

- [ ] **Step 1: Add the grammar point** (bipartite adverbial clause → `clozeUnsuitable`, same as tr-a2-converbs; SC ON; no coverageSpec)

```ts
  // G&K §26.3 (adverbial clauses: time/simultaneity), §8.5.2.2 (converb suffixes)
  {
    key: 'tr-b1-converb-while-yken',
    clozeUnsuitable: true,
    sentenceConstructionSuitable: true,
    kind: 'grammar',
    name: 'Converb -(y)ken ("while / when")',
    description:
      '-ken attaches to an aorist/imperfective verb base or a nominal for simultaneity or background ("while doing", "when X"): gelirken, çocukken, konuşurken. The clause subject may differ from the main clause.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Eve gelirken ekmek aldım. (I bought bread while coming home.)',
      'Ben çocukken burası bir bahçeydi. (When I was a child, this was a garden.)',
      'O konuşurken herkes sustu. (While he was speaking, everyone fell silent.)',
      'Sen uyurken telefon çaldı. (The phone rang while you were sleeping.)',
    ],
    examplesNegative: [
      '*Geldiyken ekmek aldım. (wrong — -ken attaches to the aorist/imperfective base, not -DI past: gelirken)',
      '*Çocuktuken burası bahçeydi. (wrong — nominal -ken: çocukken)',
    ],
    commonErrors: [
      'Attaching -ken to the -DI past stem.',
      'Choosing the wrong base aspect (gelirken vs geliyorken).',
      'Marking the converb-clause subject incorrectly.',
    ],
    prerequisiteKeys: ['tr-a2-converbs'],
  },
```

- [ ] **Step 2: Build + invariants** → PASS
- [ ] **Step 3: Commit** — `git commit -am "feat(curriculum): TR B1 converb -(y)ken"`

---

## Task 10: `tr-b1-since-converb`

**Files:** Modify `packages/db/src/curriculum/tr.ts`

- [ ] **Step 1: Add the grammar point** (`clozeUnsuitable`; SC ON; no coverageSpec)

```ts
  // G&K §26.3 (adverbial clauses: time/"since"), §8.5.2.2. Verbal "since",
  // distinct from nominal -DEn beri (tr-a1-beri-dir).
  {
    key: 'tr-b1-since-converb',
    clozeUnsuitable: true,
    sentenceConstructionSuitable: true,
    kind: 'grammar',
    name: 'Converb "since doing" -(y)AlI / -DIğIndAn beri',
    description:
      'Verbal "since": -(y)AlI (geleli "since coming") and -DIğIndAn beri (geldiğinden beri) count elapsed time from an event. Distinct from nominal -DEn beri (A1), which attaches to nouns/time points.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Buraya geleli üç ay oldu. (It has been three months since I came here.)',
      'Onu gördüğümden beri çok düşündüm. (Since I saw him, I have thought a lot.)',
      "Türkiye'ye taşınalı Türkçe öğreniyorum. (Since moving to Turkey, I have been learning Turkish.)",
    ],
    examplesNegative: [
      '*Geldiden beri üç ay oldu. (wrong — needs the -DIK nominal + possessive: geldiğimden beri)',
      '*Gelmekten beri çok düşündüm. (wrong — not -mAk; use -(y)AlI or -DIğIndAn beri)',
    ],
    commonErrors: [
      'Using nominal -DEn beri directly on a bare verb.',
      'Wrong possessive agreement on -DIğIndAn beri.',
      'Confusing -(y)AlI with the optative.',
    ],
    prerequisiteKeys: ['tr-a1-beri-dir'],
  },
```

- [ ] **Step 2: Build + invariants** → PASS
- [ ] **Step 3: Commit** — `git commit -am "feat(curriculum): TR B1 since-converb -(y)AlI"`

---

## Task 11: `tr-b1-participles-dik-acak`

**Files:** Modify `packages/db/src/curriculum/tr.ts`

- [ ] **Step 1: Add the grammar point** (`clozeUnsuitable`, parallel to tr-a2-relative-an; SC ON; no coverageSpec)

```ts
  // G&K Ch 25 (§25.1.1 participle suffixes, §25.4 tense/aspect in RCs).
  // Non-subject relatives; the subject relative -(y)An is at A2.
  {
    key: 'tr-b1-participles-dik-acak',
    clozeUnsuitable: true,
    sentenceConstructionSuitable: true,
    kind: 'grammar',
    name: 'Non-subject relative -DIK / -(y)AcAK + possessive',
    description:
      'Object/oblique relative clauses: -DIK (realized, non-future) and -(y)AcAK (prospective) + a possessive agreeing with the clause subject: okuduğum kitap, gideceğimiz şehir. Contrast the subject relative -(y)An (A2).',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Okuduğum kitap çok güzeldi. (The book I read was very good.)',
      "Yarın gideceğimiz şehir Bursa. (The city we will go to tomorrow is Bursa.)",
      'Annemin yaptığı yemek (the food my mother made)',
      'Oturduğun sandalye kırık. (The chair you are sitting on is broken.)',
    ],
    examplesNegative: [
      '*Benim okuyan kitap (wrong — subject relative -(y)An cannot encode "the book I read"; needs -DIK + possessive: okuduğum kitap)',
      '*okuduk kitap (wrong — needs possessive agreement: okuduğum / okuduğun …)',
    ],
    commonErrors: [
      'Using -(y)An for a non-subject relative.',
      'Dropping the possessive suffix on -DIK / -(y)AcAK.',
      'Forgetting the genitive on the relative-clause subject (benim okuduğum).',
    ],
    prerequisiteKeys: ['tr-a2-relative-an'],
  },
```

- [ ] **Step 2: Build + invariants** → PASS
- [ ] **Step 3: Commit** — `git commit -am "feat(curriculum): TR B1 non-subject participles -DIK/-AcAK"`

---

## Task 12: B1 vocab umbrellas (×5)

**Files:** Modify `packages/db/src/curriculum/tr.ts` (insert in the vocab section, after the A2 vocab umbrellas)

- [ ] **Step 1: Add the five umbrellas**

```ts
  {
    key: 'tr-b1-vocab-media-news',
    kind: 'vocab',
    name: 'Media & news vocabulary (B1)',
    description:
      'B1 Turkish vocabulary for news and media: press, broadcasts, headlines, reporting, and current events.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['haber (news)', 'gazete (newspaper)', 'yayın (broadcast)'],
    examplesNegative: ['*haber ci'],
    commonErrors: [
      'Detaching the -CI agentive suffix (haberci, not *haber ci).',
      'Confusing haber (news item) with bilgi (information).',
    ],
  },
  {
    key: 'tr-b1-vocab-opinions-society',
    kind: 'vocab',
    name: 'Opinions & society vocabulary (B1)',
    description:
      'B1 Turkish vocabulary for expressing opinions and discussing society: views, agreement/disagreement, social issues, and community.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['görüş (opinion)', 'toplum (society)', 'sorun (problem/issue)'],
    examplesNegative: ['*fikir ler im ce'],
    commonErrors: [
      'Confusing görüş (considered opinion) with fikir (idea).',
      'Mis-segmenting suffix chains (fikrimce, not *fikir im ce).',
    ],
  },
  {
    key: 'tr-b1-vocab-education-career',
    kind: 'vocab',
    name: 'Education & career vocabulary (B1)',
    description:
      'B1 Turkish vocabulary for education and working life: studies, qualifications, careers, applications, and the workplace.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['eğitim (education)', 'kariyer (career)', 'başvuru (application)'],
    examplesNegative: ['*eğitim sel li k'],
    commonErrors: [
      'Confusing eğitim (education) with öğretim (instruction/teaching).',
      'Mis-segmenting derived forms (eğitimli, not *eğitim li).',
    ],
  },
  {
    key: 'tr-b1-vocab-emotions-relationships',
    kind: 'vocab',
    name: 'Emotions & relationships vocabulary (B1)',
    description:
      'B1 Turkish vocabulary for feelings and relationships: emotions, moods, friendship, family ties, and social interaction.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['duygu (emotion)', 'ilişki (relationship)', 'güven (trust)'],
    examplesNegative: ['*duygu sal lık'],
    commonErrors: [
      'Confusing duygu (emotion) with his (sense/feeling).',
      'Mis-segmenting derived forms (duygusal, not *duygu sal).',
    ],
  },
  {
    key: 'tr-b1-vocab-abstract-concepts',
    kind: 'vocab',
    name: 'Abstract concepts vocabulary (B1)',
    description:
      'B1 Turkish abstract nouns and concepts: ideas, values, qualities, and processes used in opinion and discussion (often -lIk / -lInIz derivations).',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['özgürlük (freedom)', 'gerçek (truth/reality)', 'amaç (aim/purpose)'],
    examplesNegative: ['*özgür lük'],
    commonErrors: [
      'Detaching the -lIk abstract-noun suffix (özgürlük, not *özgür lük).',
      'Confusing amaç (purpose) with neden (reason).',
    ],
  },
```

- [ ] **Step 2: Build + invariants** → PASS
- [ ] **Step 3: Commit** — `git commit -am "feat(curriculum): TR B1 vocab umbrellas (×5)"`

---

## Task 13: B1 dictation + free-writing (×3)

**Files:** Modify `packages/db/src/curriculum/tr.ts` (dictation in the dictation section; FW in the free-writing section)

- [ ] **Step 1: Add the dictation cell**

```ts
  {
    key: 'tr-b1-dictation',
    kind: 'dictation',
    name: 'Dictation — connected speech (B1)',
    description:
      'Short B1 Turkish clips (2–3 sentences, natural connected speech with subordinate clauses); tests tracking across joined and embedded clauses.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Dün akşam haberleri izlerken telefonum çaldı ve bir arkadaşım beni davet etti.',
      'Bu konuda farklı görüşler var, ama bence en önemli sorun eğitim.',
    ],
    examplesNegative: ['*Çok uzun ya da B1 seviyesinin çok üstünde, ağır akademik bir metin.'],
    commonErrors: [
      'Losing track across an embedded -(y)ken / -DIK clause.',
      'Mis-segmenting suffix-heavy words (izlerken, görüşler).',
    ],
  },
```

- [ ] **Step 2: Add the three free-writing cells**

```ts
  {
    key: 'tr-b1-fw-an-opinion',
    kind: 'free-writing',
    name: 'Bir konudaki görüşüm',
    description:
      'A neutral prompt to state and justify an opinion on a familiar topic in a short paragraph, giving at least one reason.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Asks the learner to pick a familiar topic and state their opinion (Bence…).',
      'Requires at least one supporting reason (çünkü / bu yüzden).',
    ],
    examplesNegative: ['*Just list facts with no stated opinion.'],
    commonErrors: [
      'Listing facts without taking a position.',
      'Giving an opinion with no supporting reason.',
    ],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'tr-b1-fw-a-past-experience',
    kind: 'free-writing',
    name: 'Unutamadığım bir an',
    description:
      'A neutral prompt to narrate a memorable past experience, setting the scene with ongoing background (-(I)yordu) and recounting what happened.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Asks where/when it happened and to set the background scene.',
      'Requires recounting the key event and how it felt.',
    ],
    examplesNegative: ['*Describe daily routine in the present tense.'],
    commonErrors: [
      'Staying in the present instead of narrating the past.',
      'No background/scene-setting (no -(I)yordu).',
    ],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'tr-b1-fw-a-plan-or-hope',
    kind: 'free-writing',
    name: 'Bir planım ya da hayalim',
    description:
      'A neutral prompt to describe a future plan or wish, using future/conditional forms (-(y)AcAK, -sA) and giving a reason.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Asks for one concrete plan or hope and why it matters.',
      'Requires a future or conditional form (keşke … olsa / yapacağım).',
    ],
    examplesNegative: ['*Describe what you did yesterday.'],
    commonErrors: [
      'Describing the past instead of a plan/hope.',
      'No future/conditional form.',
    ],
    freeWriting: { register: 'neutral' },
  },
```

- [ ] **Step 3: Build + invariants** → PASS
- [ ] **Step 4: Commit** — `git commit -am "feat(curriculum): TR B1 dictation + free-writing (×3)"`

---

## Task 14: Enable B1 + update aggregate tests (GREEN seal)

**Files:**
- Modify: `packages/db/src/curriculum/index.ts`
- Modify: `packages/db/src/curriculum/curriculum.test.ts`

- [ ] **Step 1: Raise the B1 grammar floor**

In `index.ts`, change the TR line of `PER_LANGUAGE_GRAMMAR_MIN`:
```ts
  TR: { A1: 26, A2: 14, B1: 10, B2: 0 },
```

- [ ] **Step 2: Update the TR per-language counts test**

In `curriculum.test.ts`, the `per-language counts` → Turkish test, change the
assertions and rename the test:
```ts
  it('Turkish is at full Yedi İklim A1 + A2 + B1 parity (B2 disabled), has 15 vocab umbrellas, 3 dictation umbrellas, and 9 free-writing umbrellas', () => {
    const { grammar, vocab, dictation, freeWriting } = countsFor(trCurriculum);
    expect(grammar.A1).toBeGreaterThanOrEqual(26);
    expect(grammar.A2).toBeGreaterThanOrEqual(14);
    expect(grammar.B1).toBe(10);
    expect(grammar.B2).toBe(0);
    // 5 A1 + 5 A2 + 5 B1 themed vocab umbrellas.
    expect(vocab).toBe(15);
    // tr-a1 + tr-a2 + tr-b1 dictation.
    expect(dictation).toBe(3);
    // 3 A1 + 3 A2 + 3 B1 free-writing topic umbrellas.
    expect(freeWriting).toBe(9);
  });
```

- [ ] **Step 3: Update the free-writing umbrella test**

In the `free-writing topic umbrellas` describe, extend the TR test:
```ts
  it("has 3 free-writing topic umbrellas per TR A1, A2 and B1", () => {
    const fw = trCurriculum.filter((e) => e.kind === "free-writing");
    expect(fw.filter((e) => e.cefrLevel === "A1")).toHaveLength(3);
    expect(fw.filter((e) => e.cefrLevel === "A2")).toHaveLength(3);
    expect(fw.filter((e) => e.cefrLevel === "B1")).toHaveLength(3);
    for (const e of fw) {
      expect(e.freeWriting?.register).toBeDefined();
    }
  });
```

- [ ] **Step 4: Update the TR clozeUnsuitable exact-set test**

The set grows from six to nine (add the three bipartite B1 points):
```ts
  it('the full TR clozeUnsuitable set is exactly these nine points', () => {
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
      ].sort(),
    );
  });
```

- [ ] **Step 5: Run the full db package suite (now GREEN)**

```bash
pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test
```
Expected: PASS — all curriculum tests including `per-language counts`,
`assertCurriculumInvariants`, the conjugation/cloze flag sets, and
`grammarPointsAtOrBelow`.

- [ ] **Step 6: Repo-wide gate**

```bash
pnpm lint
pnpm typecheck
pnpm turbo run test --concurrency=1
```
Expected: all PASS. (Use `--concurrency=1` — the full suite flakes under parallel
load. If `infra/lambda/dist` causes phantom failures, `rm -rf infra/lambda/dist`.)

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/curriculum/index.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(curriculum): enable TR B1 (raise floor, update count/flag tests)"
```

---

## Task 15: Open PR

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/tr-b1-curriculum
gh pr create --base main --title "feat(curriculum): TR B1 (Yedi İklim, G&K-grounded)" \
  --body "Adds Turkish B1: 10 function-grouped grammar points + 5 vocab + dictation + 3 free-writing, authored fresh from Yedi İklim B1 and grounded in Göksel & Kerslake. Enables generation (floor + CURRICULUM_VERSION_TR bump). Design: docs/superpowers/specs/2026-06-19-tr-b1-curriculum-design.md. Plan: docs/superpowers/plans/2026-06-19-tr-b1-curriculum.md.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: Squash-merge** once CI is green (collapse the per-cell commits into one clean main commit; edit the squash message to the PR summary).

---

## Task 16: Post-merge generation runbook (operational — not code)

> Run after the curriculum change is deployed (so `CURRICULUM_VERSION_TR` = `2026-06-19` is live). Queries target the prod Neon branch `br-green-waterfall-ancrvpr5` (project `twilight-smoke-01114337`).

- [ ] **Step 1: Generate theory for the 15 B1 cells**

```bash
pnpm generate:theory --batch-seed   # scope to TR B1 per the script's flags
```
- [ ] **Step 2: Verify theory rows landed auto-approved (not flagged)**
```sql
SELECT grammar_point_key, review_status
FROM theory_topics
WHERE language='TR' AND cefr_level='B1'
ORDER BY grammar_point_key;
```
Expected: 15 rows, `review_status = 'auto-approved'`. Re-run / demote+reseed any
`flagged` row (plain generate no-ops on the partial unique index — use
`--batch-seed`).

- [ ] **Step 3: Trigger the exercise pool**

Either wait for the ~04:00 UTC scheduler (it now sees the new B1 cells because
the curriculum version bumped) or fire the on-demand admin generation trigger.

- [ ] **Step 4: Verify first-run yield + flag rate**
```sql
SELECT difficulty, type,
       count(*) FILTER (WHERE review_status IN ('auto-approved','manual-approved')) AS approved,
       count(*) FILTER (WHERE review_status='flagged') AS flagged
FROM exercises
WHERE language='TR' AND difficulty='B1'
GROUP BY difficulty, type ORDER BY type;
```
Expected: non-trivial approved counts per B1 cell type (cloze appears only for
non-`clozeUnsuitable` points). TR runs hot (~50% flag on cloze/translation at
A1/A2) — investigate only if a cell yields near-zero approved or flags far above
that baseline. Low yield (<3 approved) on a specific cell is a curriculum/prompt
follow-up, not a blocker for the rest.

---

## Self-review notes (spec coverage)

- Spec §"Grammar points (10)" → Tasks 2–11 (one per point, keys/prereqs/G&K anchors match).
- Spec §"Non-grammar cells" → Tasks 12–13 (5 vocab + dictation + 3 FW, register neutral).
- Spec §"Per-point flags" → encoded inline, with two grounded refinements documented at the top of this plan (passive not conjugationSuitable; three bipartite points clozeUnsuitable).
- Spec §"coverageSpec" → person+polarity on the four finite/conjugation points; default monitoring (no spec) on voice/converb/participle points. No illegal axes (only person/polarity used).
- Spec §"Enable mechanics" → Task 1 (destructure, drop drafts, version bump) + Task 14 (floor, count/flag tests).
- Spec §"Generation" + "Verification" → Tasks 14 (repo gate) + 16 (theory/pool runbook).
- Conjugation invariant (`conjugationSuitable` ⇒ person axis): satisfied — conj points are past-continuous, causative, obligation, all with a person axis.
