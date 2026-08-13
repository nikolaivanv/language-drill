# Gloss generation policy — the two points `audit:gloss` could not fix by editing rows

**Date:** 2026-08-13
**Branch:** `fix/gloss-policy`
**Status:** approved (design), pending implementation plan
**Precursor:** PR #642 (`pnpm audit:gloss`) — recommended next step 2, "decide the
generation-policy question for `tr-a1-numbers-ordinals` and
`es-a2-saber-poder-ability` before touching their rows."

---

## Background

PR #639 taught the cloze validator to *see* `glossEn`. PR #642 swept the existing
pool with it and found 86 of 1,512 glossed rows leaking their answer. Of those, 32
are `loadBearing: true` — the leak is in the gloss's own wording, so deleting a
span does not fix them.

For two points the audit went further and argued the problem is the **gloss policy
itself**, because any faithful English gloss names the answer:

- `tr-a1-numbers-ordinals` — 10 of 10 spoiled rows load-bearing. "our room is on
  the fifth floor" → `beşinci`.
- `es-a2-saber-poder-ability` — 5 of 9. "Do you know how to play the guitar?" →
  `Sabes`.

The audit's recommendation was to stop glossing those points and force the reading
in-sentence. **This design rejects that recommendation for both points**, on
evidence gathered from the production pool after the PR merged.

### The sweep artifact no longer exists

`docs/analysis/gloss-spoilage-audit-2026-08-12.md` cites
`packages/ai/audit-runs/prod-gloss-2026-08-12.{json,md}` as the only record of the
86 per-row verdicts. That directory is gitignored, holds only the *collapse* audit
runs, and the gloss run's files are not there or anywhere else on disk — the
`fix/gloss-spoilage-audit` worktree was removed. **The 54 Class A row IDs are
gone.** Any row-level repair now starts by re-running the sweep (~$3.32 full, less
if scoped with `--grammar-point`).

This does not block the present work, which touches no rows found by that run. It
is recorded because it silently re-prices next steps 1 and 3, and because it is
the second time an irreplaceable run artifact has been lost to a gitignored
directory in a removed worktree (cf. the variant-seed backfill rollback artifacts).

---

## Evidence

Queried against prod (`twilight-smoke-01114337` / `br-green-waterfall-ancrvpr5`),
read-only.

### `tr-a1-numbers-ordinals` — the policy already exists, and already works

The curriculum has a mechanism built for precisely this failure:
`selfRevealingElicitation: 'digit-form'` (`packages/db/src/curriculum/tr.ts:952`),
added 2026-07-08. It forces the number to appear as a **digit** in the visible
text, so the English cannot hand over the written form. The validator has a
matching scoring note telling it a digit cue is the *intended* elicitation and not
`contextSpoilsAnswer` (`validation-prompts.ts:279`).

The TR point carries that flag. Its approved cloze pool does not reflect it:

| Point | Flagged `digit-form` | Approved cloze rows | Generated | Digit cue |
|---|---|---:|---|---:|
| `tr-a1-numbers-ordinals` | yes | 20 | **2026-05-30 → 06-16** | **0/20** |
| `es-a1-numbers-ordinals` | yes | 20 | 2026-07-07 → 07-08 | **19/19** post-directive |
| `de-a1-numbers-ordinals` | **no** | 17 | 2026-07-22 → 07-24 | 1/17 |

Every approved TR ordinal cloze predates the directive by three to six weeks. The
one point generated *after* it, with the same flag, complies 19/19. The mechanism
is not missing and not broken — the TR pool is simply stale stock.

**The remaining live leak is `de-a1-numbers-ordinals`, which was never flagged.**

We also record a disagreement with the audit's judge on this point. With the
citation cue `(beş)` present, the gloss "the fifth floor" names the **meaning**;
the learner must still produce `beş` + `-(I)ncI` under vowel harmony. That is the
same shape as the gloss the generation prompt explicitly **sanctions** — "I drink
the coffee" → `kahveyi`, definiteness given, suffix withheld — and which the judge
correctly left alone in its own gate run 4. Naming the target's English equivalent
is not the same as naming the rule's outcome. The judge's own proposals ("floor
five") rewrite the English to dodge a word rather than fix an exercise, which is a
symptom of the same conflation. This does not change what we do — the rows are
being replaced regardless — but it bounds how much weight the 10-row figure
should carry.

### `es-a2-saber-poder-ability` — "stop glossing" is the wrong fix

The 24 glossed approved rows split cleanly, and the split is not gloss-vs-no-gloss.

**Leaky — the gloss reaches for the English lexical distinction:**

| Gloss | Answer |
|---|---|
| "Do you **know how to** play the guitar?" | `Sabes` |
| "Richard can speak three languages… **(a learned skill)**" | `sabe` |
| "My sister **knows how to** decorate the interior of a house very well." | `sabe` |
| "I can't **(don't know how to)** use a computer well." | `sé` |

**Sound — neutral "can", with the contrast forced inside the Spanish:**

| Sentence | Gloss | Answer |
|---|---|---|
| "Mi abuela ___ contar historias muy bien, **pero hoy no puede porque está cansada**." | "…**can** tell stories very well, but today she **can't** because she is tired." | `sabe` |
| "Mi hermana ___ hablar italiano muy bien **porque estudió mucho**." | "…**can** speak Italian very well because she studied a lot." | `sabe` |
| "Mi hermana ___ llevar a los niños al colegio hoy **porque su coche está roto**." | "…**cannot** take the kids to school today because her car is broken." | `no puede` |

The contrastive `pero hoy no puede…` and the causal `porque estudió…` /
`porque su coche está roto` do the disambiguating work. The neutral gloss is then
not ambiguous, because the Spanish has already forced the reading.

The audit doc's claim that a "can"-only gloss "removes the distinction the blank
tests and leaves it ambiguous" holds **only when the Spanish does not force it**.
Roughly half the existing pool already forces it. The policy is therefore
expressible as a positive rule, not an abstention.

### The enforcement gap underneath both

`contextSpoilsAnswer` is defined at `validation-prompts.ts:170` as:

> does the draft's `instructions` or `context` state the rule's outcome, name the
> required suffix/form, or otherwise let the learner write the answer without
> engaging with the blank?

It enumerates two fields, and **`glossEn` is not one of them.** PR #639 added gloss
*rendering* (`validation-prompts.ts:355`) and a gloss-consistency rule scoped to
`acceptableAnswers` (line 165), but never extended the spoil veto's own field list.

The production row #642 cites as proof the veto works — the validator flagging a
`cerca` gloss during #639's verification — was the model generalising past the
written rule. That is luck, not enforcement, and it is why the rule below needs
this fixed first.

---

## Design

Four changes, in dependency order. No new curriculum field; each point is handled
with the lever that already exists for it.

### 1. Close the `contextSpoilsAnswer` field gap

`packages/ai/src/validation-prompts.ts:170` — add `glossEn` to the enumerated
fields, so the veto covers every learner-visible surface rather than two of three.
Keep the existing carve-outs intact: the `digit-form` / `base-word-cue` scoring
notes and the vocab_recall note all narrow `contextSpoilsAnswer` for specific
cells, and must continue to.

Smallest change here, largest leverage: it is what makes change 3 enforced rather
than advisory.

### 2. Flag `de-a1-numbers-ordinals` as `digit-form`

`packages/db/src/curriculum/de.ts:570` — add `selfRevealingElicitation:
'digit-form'`. The curriculum invariant at `packages/db/src/curriculum/index.ts:286`
requires a paired non-empty `elicitationSeedValues`, so the point needs a curated
German pool. Following the ES pool's logic — seed the *hard* forms named by the
point's own `commonErrors`, not a bland 1–10 run:

- irregular and boundary ordinals: `erste`, `dritte`, `siebte`, `achte`,
  `neunzehnte`, `zwanzigste`, `einundzwanzigste`, `dreißigste`, `hundertste`
- the declined date form (`am` + ordinal): `ersten`, `dritten`, `siebten`,
  `achten`
- units-before-tens cardinal compounds: `einundzwanzig`, `zweiundvierzig`,
  `siebenundsiebzig`, `zweihundertdreißig`
- year-reading: `neunzehnhundertachtundneunzig`, `zweitausendsechsundzwanzig`
- `-mal` adverbs: `einmal`, `zweimal`, `dreimal`

Bump `CURRICULUM_VERSION_DE` (`de.ts:107`) `'2026-08-08'` → `'2026-08-13'`. Note
the side effect: a curriculum bump also clears skip-low-yield suppression, so
other DE cells re-enqueue on the next run.

### 3. A neutral-gloss clause in the anti-leak rule

`packages/ai/src/generation-prompts.ts:444` — extend the anti-leak bullet with a
principle, worked example attached:

> Where the target language **grammaticalises or lexicalises a distinction English
> collapses into one word**, the gloss MUST use the **neutral** English term and
> the L2 sentence MUST carry the contrast that forces the choice. Spanish
> `saber`/`poder` is the canonical case: English "can" covers both, so gloss with
> "can" and force the reading in Spanish (`pero hoy no puede porque está cansada`,
> `porque estudió mucho`). A gloss that reaches for the English lexical
> distinction ("know how to") or names the trigger ("(a learned skill)") is a
> spoiler.

Stated as a general principle rather than gated on a point key: it costs nothing
where it does not apply, and a key list would go stale.

Mirror it as a validator scoring note (`validation-prompts.ts`), because a
generation-side fix is nullified if validation still rejects the new shape — the
generator would emit neutral-gloss drafts and the validator would flag them
`ambiguous` for exactly the reason the audit doc predicted.

Bump `GENERATION_PROMPT_VERSION` (`generate@2026-08-11` → `generate@2026-08-13`)
and `VALIDATION_PROMPT_VERSION` (`validate@2026-08-12` → `validate@2026-08-13`).

### 4. Demote the stale TR ordinal cell

`packages/db/scripts/demote-cell-pool.ts` requires all four cell filters
(`demote-cell-pool.ts:68`), not just the point:

```
pnpm demote:pool --language TR --cefr A1 --type cloze \
  --grammar-point tr-a1-numbers-ordinals --reason pool-hygiene
```

Dry-run first, `--apply` second. The script's own header comments show the
`pnpm demote:pool -- --flag` form; confirm which form this runner actually accepts
before the applied run, since the `--` separator is known to break the
`packages/ai` CLIs. `pool-hygiene` leaves learner scores untouched
(unlike `quality` / `learner-flag`), which is correct here: the rows are stale
relative to a directive, not defective enough to revoke credit for.

**Accepted trade:** nightly exercise pre-generation is paused in prod
(`infra/bin/app.ts:54`, since 2026-07-25, for budget), so the cell sits thin until
generation resumes. Chosen deliberately over leaving known-stale rows served.

---

## Verification

- `pnpm eval:gen` A/B on the two affected cells, candidate = the in-repo prompt.
  Langfuse is the live prompt source and a push only affects future runs, so
  `eval:gen` is the only way to test a prompt change before merging.
- **The clause in change 3 is the thing under test.** It asserts a neutral-"can"
  gloss is non-ambiguous *when* the Spanish forces the contrast. That is read off
  ~12 existing sound rows, not measured. If `eval:gen` returns raised `ambiguous`
  flags on `es-a2-saber-poder-ability`, the clause is wrong as written and must
  narrow to banning only the trigger-naming parenthetical ("(a learned skill)").
- `pnpm lint`, `pnpm typecheck`, `pnpm test` from the repo root, zero failures.
  Note `pnpm test` has a known parallel-contention failure mode on `infra/lambda`
  (documented in #642); `--concurrency=1` is the control.
- Post-merge: `push-prompts` for both prod and dev, run from a **fresh main**
  checkout — pushing from a stale worktree reverts unrelated drifted prompts.

---

## Out of scope

Deliberately not in this branch:

- **The 54 Class A row repairs** and the **32 Class B rows** (#642 next steps 1
  and 3). Their row IDs require re-running the sweep first.
- **The 7 rows lost to the parser** rejecting `loadBearing: true` with
  `proposedGloss: null`, which should degrade to `borderline` rather than vanish.
- **The 9 medium-confidence point exclusions**, the first candidates for a re-run.
- **The 56 `glossEn: ""` empty-string rows** — a data-quality cleanup, not a
  spoilage risk.
- **Narrowing the A1–A2 gloss mandate** generally. The evidence here does not
  support it: the mandate is not what broke either point.
- **Resuming exercise generation.** A budget decision, paused deliberately.
