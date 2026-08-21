# TR construction-variant repass — run record, 2026-08-21 (INCOMPLETE)

Executed against **production** after PR #688 merged (`a907cdae`) and its
Production Deploy went green. **The repass is HALF DONE and STOPPED**: the
Anthropic account ran out of credit partway through the labelling pass, and
nothing has been demoted.

Backlog: `tr-construction-coverage-backlog-2026-08-20.md`.

## What ran, in order

| step | outcome |
|---|---|
| 1. Production Deploy green for `a907cdae` | **confirmed** — the 46 variant lists are live in the generation Lambda |
| 2. `push-prompts` verification | **no-op, proven from the diff.** The merge touched only `tr.ts` and a doc — no prompt file, no `*_PROMPT_VERSION`. Variant lists are curriculum data injected into the per-draft user prompt from deployed code, not a Langfuse-hosted body |
| 3. Neon snapshot | `br-ancient-sun-any6a4eo`, forked from `br-green-waterfall-ancrvpr5` |
| 4. `backfill:variant-seeds --apply` | **PARTIAL — 1,872 of ~2,830 rows, $2.64.** 31 batches failed on `invalid_request_error: Your credit balance is too low` |
| 5. `demote:pool` | **NOT RUN — deliberately.** See below |

## Why the demote was not run

Two independent reasons, either sufficient:

1. **Labelling is uneven, and demote sizing depends on it.** Per cell the plan is
   `need = approved − target + deficit`, where `deficit` sums over variants of
   `max(0, share-weighted target − labelled rows)`. On a cell with **zero**
   labelled rows the deficit computes as maximal and the demotion strips far more
   than intended. `demote:pool` also selects rows by `--content-ilike '"seedWord":
   "<variant-id>"'`, which cannot match a row carrying no variant id at all.
2. **Nothing can refill the headroom.** With no Anthropic credit the generator
   cannot produce a draft, and nightly pre-generation is separately PAUSED
   (#672). Demoting now would shrink the TR pool with no path back.

## Labelling state, measured on prod after the run

| level | type | approved | labelled | unlabelled |
|---|---|---|---|---|
| A1 | cloze | 279 | 277 | 2 |
| A1 | translation | 332 | 331 | 1 |
| A2 | cloze | 363 | 354 | 9 |
| A2 | translation | 496 | 493 | 3 |
| A2 | sentence_construction | 56 | 27 | 29 |
| B1 | cloze | 196 | 193 | 3 |
| B1 | **translation** | 446 | **262** | **184** |
| B1 | sentence_construction | 318 | 259 | 59 |
| B2 | **cloze** | 47 | **0** | **47** |
| B2 | **translation** | 297 | **0** | **297** |

A1 and A2 cloze/translation are effectively complete (1,455 of 1,470, 99%). The
tail is where the credit ran out: **B2 is entirely unlabelled**, and B1
translation is 41% short.

The handful of unlabelled rows in the complete levels are the safe failure — the
classifier declining a row writes nothing, per the `--min-confidence high`
default.

## The 15 cells that failed

```
TR:B1:translation:tr-b1-abstract-postpositions
TR:B1:translation:tr-b1-conditional-irrealis
TR:B1:translation:tr-b1-converb-while-yken
TR:B1:translation:tr-b1-copula-ol
TR:B1:translation:tr-b1-obligation-periphrases
TR:B1:translation:tr-b1-participles-dik-acak
TR:B1:translation:tr-b1-passive-voice
TR:B1:translation:tr-b1-reason-digi-icin
TR:B2:cloze:tr-b2-compound-evidential-rivayet
TR:B2:translation:tr-b2-as-if-gibi
TR:B2:translation:tr-b2-aspectual-verbs
TR:B2:translation:tr-b2-compound-evidential-rivayet
TR:B2:translation:tr-b2-concessive
TR:B2:translation:tr-b2-instead-of
TR:B2:translation:tr-b2-reported-directives
```

## The artifact

`tr-variant-seeds-prod-2026-08-21.json` — `applied: true`, `appliedCount: 1872`,
`entries: 1872`, so every recorded entry was written and there is no
partial-write gap. It is the **only** record of those 1,872 rows' original
`seedWord` values (legacy frequency-band seeds, not nulls), and
`packages/db/backfill-runs/` is gitignored — so it is archived to
`.claude/backfill-artifacts-prod-2026-08/` as well. Revert with
`--revert <artifact> --apply`.

## To resume

1. **Top up the Anthropic account.** Verified still exhausted at 03:26 by a
   scoped probe against `tr-b2-as-if-gibi` — $0.00 spent, 0 rows applied, clean
   failure. This also means nightly generation would fail today even if
   un-paused.
2. Re-run the labelling for the failed tail only, e.g.
   `--cefr B2` and then the eight B1 translation points by `--grammar-point`.
   Cost is roughly $1 at the measured rate ($2.64 for 1,872 rows). **Name every
   run** — the artifact is irreplaceable.
3. Verify labelling is complete with the query in this file, then capture every
   candidate row id into `docs/analysis/` **before** demoting — `demote:pool`
   produces no rollback artifact.
4. `demote:pool --reason pool-hygiene` (never `quality`, which revokes learners'
   credit for past attempts).
5. Then the sentence_construction tail: 374 SC rows on variant points, of which
   286 are now labelled and 88 are not.

## Cost

$2.64 for the main pass, $0.00 for the probe. The four audit chunks that
preceded this were $4.43.
