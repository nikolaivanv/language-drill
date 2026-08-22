# TR SC three-point repass — run record, 2026-08-22

Closes the deliberate gap left by #691: the three points that PR authored were
not demoted at the time because their variants were not yet deployed. #691's
Production Deploy (`7268a02d`) is now green, so the generation Lambda carries
their variant lists and freeing slots is safe.

Together with the two-point pass on the same day (#691's record), every TR point
that declares `constructionVariants` has now been through label + demote.

## Why the wait mattered

Demoting before the deploy would have freed slots that the scheduler refills
from a prompt carrying **no variant directive** — regenerating exactly the
constructions the demotion exists to displace. `tr-b2-double-voice` would have
gone straight back to 14/14 causative+passive. Pre-generation was being enabled
the same day, so this was a live risk rather than a theoretical one.

## What ran

Snapshot `br-damp-pond-ang2q094`. Labelling ran **before** the deploy (it only
writes labels; the deploy gate is on demotion), so the pass was ready the moment
the deploy landed.

- **Labelled:** 252 of 296 rows, **$0.44**.
- **Demoted:** **80 rows across 7 cells**, 12 invocations, 0 failures, 0 retries,
  0 count mismatches.

| cell | approved → | target |
|---|---|---|
| `tr-a2-aorist:cloze` | 46 → **27** | 30 |
| `tr-a2-aorist:translation` | 46 → **31** | 30 |
| `tr-a2-aorist:sentence_construction` | 48 → **43** | 30 |
| `tr-b1-causative-voice:translation` | 50 → **41** | 50 |
| `tr-b1-causative-voice:sentence_construction` | 76 → **52** | 50 |
| `tr-b2-double-voice:translation` | 16 → **14** | 15 |
| `tr-b2-double-voice:sentence_construction` | 14 → **8** | 15 |

Verified against the pre-committed capture: 80 captured, 80 demoted, 0 still
approved, all `pool-hygiene` — learners keep credit, no `backfill:mastery`
rebuild needed.

`tr-a2-aorist`'s cloze and translation targets are 30, not the 48 they carried
before #691. That is the `appliesTo: [CONJUGATION]` scoping working: the person
floors that raised the target no longer apply outside the conjugation cell, so
46 approved rows became 16 over target rather than 2 under it. The conjugation
cell still targets 48 and was untouched.

## The one stuck batch

`tr-a2-aorist:sentence_construction` lost a batch to the classifier returning a
row id that was not in it — the same deterministic fault seen on
`tr-b1-copula-ol:translation` on 2026-08-21, which a scoped retry reproduced
exactly. It was not retried here. 44 of 296 rows are consequently unlabelled,
which caps how much that cell could be demoted (28 needed, 5 taken): the surplus
is bounded by what is labelled, and an unlabelled row cannot be matched by
`--content-ilike`.

## Cost

$0.44 labelling. The demotion itself makes no API calls.
