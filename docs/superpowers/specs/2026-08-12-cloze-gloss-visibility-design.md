# The cloze `glossEn` blind spot — Design

**Date:** 2026-08-12
**Branch:** `fix/cloze-gloss-visibility`
**Status:** approved (design), pending implementation plan
**Found by:** `pnpm qa:sample --language ES --cefr A1 --type cloze --per-point 2 --seed 1`
(50 sampled, 4 flagged, $1.81 — report `docs/analysis/qa-run-2026-08-12-prod-es-a1-cloze.json`)

---

## Background

A cloze exercise may carry an optional `glossEn` field — an English gloss of the
sentence's meaning. The generator is *instructed* to produce it: `generation-prompts.ts`
mandates a gloss for A1–A2 cloze as a disambiguation device ("Populate `glossEn` for
CEFR **A1–A2 only**; omit it for **B1+**"), specifically so a short L2 sentence can
pin down a reading it could not otherwise force.

The learner sees it — `apps/web/components/drill/cloze-prompt.tsx:112` renders it
under a "Meaning" label.

**Nothing else does.** `grep glossEn` returns no hit in either
`packages/ai/src/prompts.ts` (the evaluator prompts) or
`packages/ai/src/validation-prompts.ts` (the validator prompts). So a field that
constrains the correct answer, and that the learner reads, is invisible to both the
validator that approves the row and the evaluator that grades the answer.

This single omission produces two independent failures, one at generation time and
one at answer time.

### Symptom 1 — the evaluator awards full credit to answers the gloss rules out

`es-a1-querer-poder-infinitive` (`8a84bbba-7ef0-5d3a-918c-fcf68d19a97b`):

| Who | Sees |
|---|---|
| Learner | *"I can't eat the soup without salt."* + `No ___ comer la sopa sin sal.` |
| Evaluator | `No ___ comer la sopa sin sal.` only |

The crafted wrong answer `puedes` (2nd person) scored **1.0**. On the Spanish alone
it is impeccable, and #612's cloze rule tells the evaluator exactly that: *"When the
visible sentence does not itself fix the tense/aspect/number, any form the sentence
licenses is correct."* The sentence doesn't fix the person — **the gloss does**, and
the evaluator never received it.

### Symptom 2 — the validator cannot see a self-contradictory row

`es-a1-locative-prepositions` (`f587a1fe-8372-5642-a5d2-f7fecf875093`) ships with
`glossEn: "The park is near the school."` **and** `acceptableAnswers: ["lejos"]` — the
antonym. The evaluator scored `lejos` 1.0 because the content *declares* it acceptable;
that is the evaluator obeying the row, not being lenient. The defect is that the row
exists, and it exists because `buildClozeValidationUserPrompt` never showed the
validator the gloss it contradicts.

The validator already holds the governing principle, in the `ambiguous` dimension:

> `más` and `menos` are ANTONYMS, not alternants, so listing both teaches they are
> interchangeable — a clean draft anchors one pole and lists neither in
> `acceptableAnswers`.

That reasoning covers `cerca`/`lejos` exactly. It could not fire, because it was
scoped to comparative polarity and because the gloss was absent from the prompt.

---

## Scope of the existing damage

A read-only audit (SQL only, no AI spend) of every approved cloze row pairing a gloss
with acceptable answers — **39 rows** — is fully enumerated in the appendix: **20
contradict their gloss** (18 + 2 below), **19 are legitimate**. The 20 fall into two
classes whose fixes point in *opposite* directions:

**Class A — meaning-flip (18 rows).** The alternative changes what the sentence means,
away from what the learner was shown: `tr-a1-clock-time-dates` glosses "at three
o'clock" and accepts **eleven other hours**; five `es-a1-querer-poder-infinitive` rows
swap "can" for "want"; `de-a2-measure-expressions` glosses "twice a week" and accepts
once/three/four/five times; demonstratives and possessives swap the referent or person.
Here the gloss is the constraint the learner actually read, so the **acceptableAnswers
entry is what is wrong** → trim it.

**Class B — lexical substitution (2 rows).** `de-a1-zero-article` (gloss "My brother is
a teacher", accepts Arzt/Koch/Schüler/Student/Verkäufer) and
`de-a2-adjective-declension-indefinite` (gloss "a red pen", accepts
blauer/grüner/schwarzer/…). The grammar point is a **form** — the zero article, the
`-er` ending — and every listed alternate satisfies it. The acceptableAnswers are
pedagogically right; the **gloss is over-specified** → relax the gloss.

**The correct pattern already exists in the pool.** `524feb4e` glosses *"I want/can
walk to the park every day"* and `d5342831` *"This / That planet is very big"* — the
generator wrote an inclusive gloss matching its own alternates. The validator rule
below points at this, rather than inventing a convention.

Two incidental nits, recorded but not fixed: `54508ca9` lists an acceptable answer
byte-identical to its `correctAnswer`, and `b76b557e` differs from it only in
capitalization. Harmless; they suggest the field is sometimes filled reflexively.

---

## The fix

Four parts. Parts 1–2 are **user-prompt-only** edits — they ship with the code deploy
and need **no Langfuse push** (the same class as #612 and #620). Part 3 edits the
cached system template and **does** require a push per environment.

### 1. Render the gloss to both consumers

Add to `buildClozeUserPrompt` (`packages/ai/src/prompts.ts`) and
`buildClozeValidationUserPrompt` (`packages/ai/src/validation-prompts.ts`), rendered
only when the field is present:

```
**Meaning (shown to the learner):** <glossEn>
```

The label states the visibility fact, because both prompts already reason explicitly
about what the learner did and did not see. Bump `EVALUATION_SYSTEM_PROMPT_VERSION`
and `VALIDATION_PROMPT_VERSION` to their `@2026-08-12` values for trace cohorting,
with the usual dated comment.

### 2. Make the gloss binding for the evaluator

The cloze user prompt's visibility clause currently enumerates what the learner saw as
"the **Sentence** (with the blank), the **Instructions**" (plus **Options** when
revealed). Add the Meaning line to that enumeration when present, and one clause:

> When a **Meaning** line is present, it is part of what the learner saw and it
> constrains the answer: a fill that is grammatical in the sentence but contradicts the
> stated meaning is NOT correct.

This deliberately narrows #612's "any form the sentence licenses is correct". That
rule was written to stop the evaluator inventing unstated context to justify rejecting
a valid answer — a real problem it fixed. The gloss is not invented context: it is
context the learner was actually given, and which the evaluator was wrongly denied.
The narrowing is therefore in the spirit of #612's information-symmetry goal, not an
exception to it. The rest of the anti-anchoring block is left untouched.

### 3. Validator rule — a gloss and its acceptable answers must agree

Extend the `ambiguous` dimension in `VALIDATION_SYSTEM_PROMPT_TEMPLATE`
(`validation-prompts.ts`, the block at line 153 that already carries the antonym
precedent) with a cloze sub-bullet:

> **Gloss consistency (cloze):** when the draft carries a `glossEn`, every entry in
> `acceptableAnswers` must be true *under that gloss*. An entry that changes the
> meaning the gloss states — a different hour than the one glossed, an antonym, a
> different person or referent — is a defect, not an alternant: set
> `ambiguous = true`. Two cures, and the draft must pick one: widen the gloss so it
> covers every listed answer (`"I want/can walk to the park every day"` for
> `quiero`/`puedo`; `"This / That planet is very big"` for `Este`/`Ese`/`Aquel`), or
> drop the entries the gloss excludes. When the grammar point is a **form** rather
> than a lexeme (the zero article before a profession, an adjective's declension
> ending) and the alternates are different lexemes that all realize that form, prefer
> widening or omitting the gloss — the alternates are legitimate.

`VALIDATION_PROMPT_VERSION` is already bumped by part 1; note in its comment that the
template body changed too, so this half needs the push.

### 4. Repair the contradictory rows in place

Nightly generation is **paused in prod**, so demotion would shrink cells with nothing
to refill them. Repair instead, per the appendix's per-row verdict:

- **Class A** — remove the gloss-contradicting entries from `acceptableAnswers` via a
  targeted `jsonb_set` on a single id; where that empties the array, remove the key.
- **Class B** — widen `glossEn` (`"My brother is a teacher / doctor / cook …"` reads
  poorly; prefer dropping the gloss for these two, since the sentence
  `Mein Bruder ist ___ .` plus the profession options is already unambiguous for a
  zero-article drill).
- `review_status`, `demotion_reason`, mastery, and history are untouched — this is a
  content repair, not a demotion. No `demote:pool`, no `backfill:mastery`.
- Prior `content_json` captured before each write; every id and verdict is listed in
  the appendix, so the writes are reviewable line by line.

---

## Verification

1. **Unit tests** in `prompts.test.ts` and `validation-prompts.test.ts`: the Meaning
   line renders when `glossEn` is present, is absent when it is not, and the
   evaluator's visibility clause names it only in the present case. `prompts.test.ts`
   already pins the cloze prompt's visibility wording, so those assertions move with
   the change.
2. **`pnpm eval`** on a new fixture (`eval-cloze-gloss-binding`) built from the two
   real prod rows: `8a84bbba` with `puedes` (baseline 1.0 — the defect) and
   `f587a1fe` with `lejos`. Success = both drop below `PASS_THRESHOLD` 0.8 with the
   gloss rendered. Baselines captured against the live prompt **before** the edit,
   since `eval:seed` skips existing seed keys and cannot be corrected in place.
3. **`pnpm eval:gen`** for the validator rule, forcing the in-repo prompt: a draft
   glossed "at three o'clock" listing other hours must come back `ambiguous`, and the
   inclusive-gloss pattern must not.
4. **Re-run the finding run** — `qa:sample --language ES --cefr A1 --type cloze
   --per-point 2 --seed 1` — and confirm the two gloss-related flags clear.
   Per the standing lesson, judge this by **replaying the recorded probe strings**
   (`puedes`, `lejos`) rather than trusting a clean re-sample: the crafter is unseeded,
   so a fresh run invents fresh probes. n≥10 on each probe before calling it fixed.
5. Full `pnpm lint && pnpm typecheck && pnpm test` from the worktree root.

## Rollback

Parts 1–2 and 4 revert with a code revert and a reverse `jsonb_set`. Part 3 reverts by
re-pointing the Langfuse `production` label at the version `push-prompts` logs.

## Out of scope, deliberately recorded

- **`es-a1-relative-que-basic`** — the wrong answer `quien` scored 0.85 where a
  restrictive relative clause with no preposition requires `que`. Real but narrow, and
  unrelated to the gloss (the gloss "who speaks three languages" does not disambiguate
  it). It needs its own n≥10 evidence before anyone designs a fix — the lesson from
  the `gustar` case, where a single draw produced a false "closed" verdict.
- **`es-a1-noun-gender`** — flagged `acceptable_answers_gap` on alt `el` in
  `Siempre hay ___ problema`. Dismissed: existential *hay* rejects a definite article,
  so `hay el problema` is ungrammatical and scoring it 0.15 was correct. A crafter
  artifact, like the `adjective-de-infinitive` dismissal in
  `docs/analysis/qa-sample-findings-2026-08-11.md`.
- **The two degenerate `acceptableAnswers` nits** above.
- **Whether the generator should emit `glossEn` at all for lexical-form points** —
  Class B suggests the mandate is too broad, but changing generation policy is a
  larger question than this fix.

---

## Appendix — the 39 audited rows

Every approved cloze row with both a `glossEn` and a non-empty `acceptableAnswers`,
as of 2026-08-12. **Verdict** is the repair decision for part 4.

### Class A — meaning-flip: trim `acceptableAnswers`

| id | point | gloss | correct | contradicting entries |
|---|---|---|---|---|
| `f587a1fe-8372-5642-a5d2-f7fecf875093` | es-a1-locative-prepositions | "The park is near the school." | `cerca` | `lejos` |
| `8a84bbba-7ef0-5d3a-918c-fcf68d19a97b` | es-a1-querer-poder-infinitive | "I can't eat the soup without salt." | `puedo` | `quiero` |
| `ff930512-f29e-579e-aefb-6ec232acbb37` | es-a1-querer-poder-infinitive | "I can't go out today because I have a lot of work." | `puedo` | `quiero` |
| `919550de-602a-5024-8b0e-84b8dbcf8329` | es-a1-querer-poder-infinitive | "I can't change my mind now." | `puedo` | `quiero` |
| `8684b56e-8363-544e-8d8c-f682918c20bf` | es-a1-querer-poder-infinitive | "I want to live on another planet." | `quiero` | `puedo` |
| `8b84bd4d-000d-5aff-928c-fe930bfd0baa` | es-a1-querer-poder-infinitive | "I want to try that new dish." | `quiero` | `puedo` |
| `961d5cc1-380e-5459-9a2c-95f5cf9dbec0` | es-a1-demonstratives | "That old building is very big." | `Ese` | `Este` (gloss says *that*); `Aquel` is defensible |
| `ba6b5a37-2987-5721-acea-becd91d0bbd4` | es-a1-possessives-atonic | "This is my old school." | `mi` | `tu`, `su` |
| `d2432ce9-68c4-57bf-9a2a-bf33a781723a` | es-a1-possessives-atonic | "I don't know your way to school well." | `tu` | `su` |
| `a55c11b5-15bb-524b-8107-42d7ed5cadee` | tr-a1-clock-time-dates | "The train departs at three o'clock." | `üçte` | all 11 other hours |
| `6d007852-7206-5502-986a-c66e4a416a9b` | tr-a1-clock-time-dates | "School starts at eight o'clock every day." | `sekizde` | all 11 other hours |
| `8ab8565b-62c4-5141-ab3c-989dbdb1508c` | tr-a1-clock-time-dates | "School starts at eight every morning." | `sekizde` | `yedide`, `dokuzdа`, `*buçukta`, `saat yedide`, `saat dokuzda` (keep `saat sekizde`) |
| `67006ee0-743f-508c-926a-bcc04c7aa63d` | tr-a1-clock-time-dates | "School starts at eight every day." | `sekizde` | `dokuzda`, `yedide`, `onda`, `*buçukta`, `saat dokuzda`, `saat yedide`, `saat onda` (keep `saat sekizde`) |
| `75bbe719-63c2-5a89-900d-b6659aa2b500` | tr-a1-demonstratives | "This place is very hot! …" | `Burası` | `Şurası`, `Orası` |
| `7dcf20fc-26b1-508a-852c-03d6666c3cbf` | tr-a1-demonstratives | "This bread is very hard." | `Bu` | `Şu`, `O` |
| `7ebbf544-e951-5f62-8d0d-b18e2b4ff43f` | tr-a1-demonstratives | "This place is very beautiful!" | `Burası` | `Şurası`, `Orası` |
| `77bbea3f-6189-5eff-960d-c013a14e67e6` | tr-a1-demonstratives | "This (place) is my school." | `Burası` | `Şurası`, `Orası` |
| `6590f5ee-f6bc-5c60-88d3-6d8cb568e735` | de-a2-measure-expressions | "The doctor comes twice a week." | `zweimal` | `einmal`, `dreimal`, `viermal`, `fünfmal` |

`8ab8565b` also carries a Cyrillic **а** in `dokuzdа` — a homoglyph typo in stored
data, worth removing with the rest of that entry.

### Class B — lexical substitution: relax or drop the gloss

| id | point | gloss | correct | acceptable | verdict |
|---|---|---|---|---|---|
| `7858b64e-7e2b-5a86-b903-31da8ca8540f` | de-a1-zero-article | "My brother is a teacher." | `Lehrer` | Arzt, Koch, Schüler, Student, Verkäufer | drop `glossEn` |
| `09acd36d-4210-5021-b0ee-925dc6052058` | de-a2-adjective-declension-indefinite | "There is a red pen on the table." | `roter` | 13 other adjectives | drop `glossEn` |

### Legitimate — no action

Gloss and alternates agree; the alternates are true variants of one meaning.

| id | point | why it is fine |
|---|---|---|
| `524feb4e-bae6-51ba-b45f-30e603cc1d73` | es-a1-querer-poder-infinitive | gloss "I want/can walk" is inclusive — **the target pattern** |
| `d5342831-007d-545f-92f3-0703dafea6f2` | es-a1-demonstratives | gloss "This / That planet" is inclusive — **the target pattern** |
| `d334250b-fe44-58d5-90f3-03c9d8c56b50` | es-a1-demonstratives | gloss "This/That backpack" is inclusive |
| `b76b557e-a631-5dd2-b1ea-c6de10b41e03` | es-a1-possessives-atonic | `Su`/`su` — capitalization only (degenerate, harmless) |
| `5155bc49-1840-5697-8bbf-cabbdfd30fda` | de-a2-two-way-prepositions-core | `aufs` / `auf das` — contraction of the same form |
| `12b0519e-3660-596e-aad0-7f522f0f0ab7` | es-a2-periphrases-obligation-aspect | `Tengo que` / `Hay que` — personal vs impersonal obligation, both fit the gloss |
| `eb9b3818-4b36-5556-969a-3f6a8a01f8c3` | es-a2-periphrases-obligation-aspect | `realizarlo` / `realizar` — optional clitic |
| `69007206-7678-5c16-946a-bffa4eb3e1df` | tr-a1-clock-time-dates | `dokuzda` / `saat dokuzda` — same hour, optional `saat` |
| `84cddbad-65e7-511b-9ade-eac7fb7e58f6` | tr-a1-imperative | `gitmeyin` / `gitmeyiniz` — formality variants |
| `fc335f50-c4c4-5c60-ac82-433c76e69b89` | tr-a1-personal-suffixes | plural agreement genuinely optional here |
| `bb2af260-1210-5894-bad8-2b682d4a9845` | tr-a1-personal-suffixes | same |
| `d3e0dc9a-2f99-5c16-84ba-897a2457d867` | tr-a1-personal-suffixes | same |
| `08763ff8-7a92-5c54-ae1d-2ac8e949b7d5` | tr-a2-ability-necessity | `konuşamıyorum` / `konuşamam` — both "I can't speak" |
| `ce316f88-ceba-51d6-b114-370aca9a7783` | tr-a2-ability-necessity | same |
| `009d6c1c-5aa0-55d2-a4df-f51e974c1897` | tr-a2-causal-connectors | `bu yüzden` / `bu sebeple` — synonyms |
| `873c1366-0a1f-50ec-b070-e42041d97511` | tr-a2-past-copula | `meşguldüler` / `meşguldu` — attested variants |
| `53eb1e21-84c4-53ad-b662-2961e00a386c` | tr-a2-past-copula | `yaramazlardı` / `yaramazdılar` — suffix-order variants |
| `f3220321-ba3a-56a1-9834-c7dd1bba2cb0` | tr-a2-reflexive-reciprocal-pronouns | `birbirine` / `birbirlerine` — attested variants |
| `54508ca9-a23c-5b33-a6b6-24bf044fe0e6` | tr-a2-mis-evidential | acceptable answer identical to `correctAnswer` (degenerate, harmless) |

**Exposure beyond these 39.** 1,570 approved cloze rows carry a `glossEn` at all
(TR A1 464, ES A1 297, TR A2 289, ES A2 265, DE A2 128, DE A1 84, and a long tail at
B1/B2 where the generator is told to omit it). Those rows have no contradiction to
repair, but every one of them has been graded by an evaluator that could not see the
gloss — which is what part 1 fixes going forward.
