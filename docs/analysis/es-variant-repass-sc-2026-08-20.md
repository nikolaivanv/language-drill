# ES variant repass — the sentence-construction tail, 2026-08-20

Closes the gap recorded as item 2 of "What is NOT done" in
`es-variant-repass-2026-08-20.md`. Kept as a separate file because that record
documents the cloze/translation sweep, and this is a different tool state.

## The gap

`backfill:variant-seeds` hard-coded `ELIGIBLE_TYPES = {CLOZE, TRANSLATION}`, but
`seedKindFor` has routed `SENTENCE_CONSTRUCTION` to variant seeding since #652
for any point that declares variants. So SC rows generated after #652 carry a
variant id, the legacy pool does not, and nothing could label it.

Zero labels is not a rounding error in that position. It is exactly the input
`pickVariantSeeds` reads as "no variant is covered anywhere", and its answer is
to spread new drafts evenly across every variant instead of chasing the gaps —
the failure the whole repass exists to prevent. On the generation resume both
affected cells would have hit it.

## What labelling found

Both cells were **totally collapsed** — a sharper result than any
cloze/translation cell in the main sweep:

| cell | before | realized | at zero |
|---|---|---|---|
| `es-b1-present-subjunctive:sc` | 75 approved, 0 labelled | **74 of 74** on `subj-after-trigger-verb` | 6 of its 7 variants |
| `es-b2-past-subjunctive:sc` | 73 approved, 0 labelled | **62 of 62** labelled on `past-tense-trigger-subjunctive` | 2 of its 3 variants |

138 rows labelled for **$0.25** (`sc-<key>-2026-08-20` artifacts, snapshot branch
`br-proud-leaf-anhky01u`).

## What was demoted

82 of the 94 rows captured in `es-variant-repass-sc-demote-ids-2026-08-20.json`.
The 12 the classifier declined stay approved — `demote:pool` selects by content
substring and cannot express "unlabelled", the same constraint as every other
pass.

| cell | approved → | target | headroom |
|---|---|---|---|
| `es-b1-present-subjunctive:sc` | 75 → **26** | 75 | 49 |
| `es-b2-past-subjunctive:sc` | 73 → **40** | 75 | 35 |

Verified against the capture file: 82 demoted, 12 still approved, nothing outside
the captured set touched.

The other two ES SC cells — `es-b1-conditional` (75 rows) and
`es-b1-relative-clauses` (49) — declare no variants, so they are correctly
untouched and unlabelled.

## The tool change

`ELIGIBLE_TYPES` gains `SENTENCE_CONSTRUCTION`, and `toClassifierRow` gains an SC
branch. SC needs its own mapping because it has no `correctAnswer`:

- **answer** = the row's `modelAnswers`, capped at three and joined — they are the
  Spanish the row is built around, and they are the strongest evidence of which
  sub-construction it realizes.
- **prompt** = the situation prompt, with `targetStructure` appended when present.
  That field is the generator's own prose description of what the draft was asked
  for, which is the question being asked here.
- A row with no usable model answer returns `null` rather than asking the
  classifier to pick a variant from a situation prompt alone.

Five tests cover the new branch, including the cap and the two null paths.
