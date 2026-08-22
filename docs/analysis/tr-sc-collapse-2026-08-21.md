# TR sentence-construction collapse — measurement, 2026-08-21

**Result, in two stages.** The signals available at the time said the pool was
not collapsed, and no demotion was run. Then the blind spot those signals left
was closed — see the follow-up at the bottom of this file — and **three
variant-less points turned out to be genuinely collapsed after all**, including
one at 14 of 14 rows on a single construction.

Read the two halves together. The first half is not wrong: nothing in it
justified a demotion, and demoting on it would have been demoting on noise. But
its conclusion was bounded by what the tooling could see, which is why it ends by
naming the gap rather than declaring the pool healthy.

## Why this was checked at all

`audit:constructions` reads `IN_SCOPE_TYPES = {CLOZE, TRANSLATION}` only, so the
whole TR sweep never examined a single sentence-construction row. Separately,
**404 approved SC rows across 8 points carry no `seedWord` at all** — those
points declare no `constructionVariants`, so they fall to frequency seeding,
which SC only gained in #652 (2026-08-14). Those rows predate it and were
generated with no diversity mechanism whatsoever, the condition #652's own commit
message predicts will collapse a cell.

| point | approved | seeded |
|---|---|---|
| `tr-b1-causative-voice` | 76 | 0 |
| `tr-b1-reciprocal-voice` | 67 | 0 |
| `tr-b1-reflexive-voice-kendi` | 66 | 0 |
| `tr-b1-when-converbs` | 54 | 0 |
| `tr-b1-since-converb` | 50 | 0 |
| `tr-a2-aorist` | 48 | 5 |
| `tr-a2-converb-temporal` | 29 | 4 |
| `tr-b2-double-voice` | 14 | 0 |

## What was run

`audit:collapse --language TR --type sentence_construction` (666 rows, 16 cells).
Its dry-run is genuinely free and still runs the deterministic sweep; the real
run added 2 triage calls for **$0.01**.

## Result

**Answer-surface concentration — clean.** Top-surface share is 4–24% across all
16 cells, against the ≥65% threshold that flagged ES's 49 collapsed points. For
SC this signal reads `modelAnswers` (`collapse-metrics.ts:58`) — the **Turkish**,
which is the thing we care about.

**Stem-monotony — 3 flags, all spurious.** `tr-a2-reported-speech` (92% "what")
was `preempted` correctly, its declared mechanism simply being unrealized.
`tr-b1-reciprocal-voice` (93% "each") and `tr-b1-when-converbs` (87% "what") were
triaged and both returned **`metric-artifact`, high confidence**.

They are right. For SC the monotony signal reads `prompt`
(`collapse-metrics.ts:394`), which is the **English** scene text — hence top
lemmas of `what`, `each`, `friend`, `why`, `describe`, `verb`, `causative` across
the whole sweep. "each" at 93% on the reciprocal point is the gloss "each other";
"what" at 87% on the when-converbs point is the instruction phrasing. Neither
says anything about Turkish diversity.

**Take the SC monotony signal as near-useless.** It measures instruction
boilerplate, not content. CLAUDE.md already calls it "a calibration-phase
stem-monotony hint"; on SC specifically it should be read as noise.

## The variant cells, for the record

The 8 SC cells on variant-declaring points show exactly the expected post-repass
state — `yken-nominal` 0, `yken-contrastive` 0, `ol-conditional` 0,
`impersonal-passive-intransitive` 0, `integrated-digini-soyledi` 0. That is the
headroom the 2026-08-21 repass opened, waiting on the generation resume. Nothing
to do there.

## The residual blind spot — real, and NOT closed by this

Neither tool can see **construction-level** collapse in SC on a point that
declares no variants and no spec:

- `audit:collapse` sees answer surfaces and *declared* mechanisms. These points
  declare nothing, so its declared-but-unrealized signal is vacuous on them, and
  its lexical signal cannot tell "45 rows of one construction over 45 different
  nouns" from genuine diversity — the exact blind spot that motivated
  `audit:constructions` in #667.
- `audit:constructions` could see it, but does not read SC at all.

So "the surface is diverse" is a weaker claim than "the constructions are
diverse". A cell could open with 40 different Turkish phrases and still drill one
sub-construction throughout.

Closing it means extending `audit:constructions` to sentence_construction —
mirroring what #687 did for `backfill:variant-seeds`, which needed an SC branch
because SC has no `correctAnswer` (use `modelAnswers` for the answer and the
situation prompt plus `targetStructure` for the prompt). That is a tooling
change, not a data pass, and it is the honest prerequisite before anyone
concludes these 8 points are fine.

## Cost

$0.01.

---

# Follow-up: `audit:constructions` extended to SC, and what it found

The blind spot above is now closed. `IN_SCOPE_TYPES` gains
`SENTENCE_CONSTRUCTION` and `rowSurfaceFor` gains an SC branch, mirroring what
#687 did for `backfill:variant-seeds`: SC has no `correctAnswer`, so the
**model answers** are the evidence (capped at three), `targetStructure` rides
along as the generator's own statement of what the draft was asked for, and a
row with no usable model answer returns null rather than inviting a guess from a
situation prompt alone.

First run: 16 points, 16 cells, 370 rows, **7 findings, $0.70**.

## It was a real blind spot

Two variant-less points are genuinely collapsed, and **neither was visible to
`audit:collapse`** — both passed its surface signal comfortably:

| point | rows | what the SC pool actually drills |
|---|---|---|
| `tr-b2-double-voice` | 14 | **14 of 14** are `causative-plus-passive`. `causative-of-causative` **0**, `reciprocal-plus-causative` **0** — two of the three combinations the point exists to teach |
| `tr-b1-causative-voice` | 76 | `-DIr` 12 and `-t` 12, but **`-Ir`/`-Ar` 0** — a whole allomorph group from the point's own title (`-DIr / -t / -Ir / -Ar`) never appears |
| `tr-a2-aorist` | 48 | the irregular 1sg negative `-mAm`, which the description calls out by name, is **0** |

`tr-b2-double-voice` is the sharpest illustration of why the surface metric could
not see this: 14 rows drilling one construction, over 14 different scenes, is
lexically diverse and structurally monotonous at the same time.

The remaining four findings are on points already through the variant repass
(`tr-b1-copula-ol`, `tr-b1-participles-dik-acak`, `tr-b1-passive-voice`,
`tr-b1-abstract-postpositions`); their zeros are the declared variants awaiting
regeneration, which is expected and needs no action.

## Seven cells reported `enumeration-suspect`

`tr-a2-converb-temporal`, `tr-a2-reported-speech`, `tr-b1-converb-while-yken`,
`tr-b1-reason-digi-icin`, `tr-b1-reciprocal-voice`, `tr-b1-since-converb`,
`tr-b1-when-converbs` — all >33% unresolved, so **no finding was raised**, which
is the designed behaviour: a high unresolved rate means the construction list was
wrong, not that the pool collapsed. Worth noting that this is a much higher
suspect rate than the cloze/translation sweep saw (7 of 16 cells vs 2 of 142),
which suggests the enumeration prompt may fit SC less well than it fits the other
two types. Not investigated here.

## Still to do

Author `constructionVariants` on the three collapsed variant-less points. Note
`tr-a2-aorist`'s proposed variants are polarity-based and it is
`conjugationSuitable`, so it needs the `appliesTo` treatment rather than a spec
deletion — the same shape as `tr-a1-ablative-dative`.

---

# Demotion of the two deployed points, 2026-08-22

Only **two** of the five newly-authored points were demoted:
`tr-a1-ablative-dative` and `tr-b2-compound-past-hikaye`, both from #690, whose
Production Deploy (`c47a5ff0`) is green — so their variant lists are live in the
generation Lambda.

The three SC points authored here (`tr-a2-aorist`, `tr-b1-causative-voice`,
`tr-b2-double-voice`) were **deliberately not demoted**. Their variants are not
deployed yet, so freeing slots now would let the scheduler refill them from a
prompt carrying no variant directive — regenerating the very constructions the
demotion is meant to displace. That risk is live rather than theoretical, since
pre-generation is being enabled the same day. They wait for this PR to merge and
deploy.

## What ran

Snapshot `br-bold-sun-anp6yiwq`. Labelling first — neither point had ever been
through a repass — then capture, then demote.

- **Labelled:** 124 rows, **$0.17**, no failures (36 + 88).
- **Demoted:** **26 rows across 3 cells**, 5 invocations, 0 failures, 0 retries,
  0 count mismatches.

| cell | approved → | target |
|---|---|---|
| `tr-a1-ablative-dative:cloze` | 19 → **17** | 24 |
| `tr-a1-ablative-dative:translation` | 20 → **16** | 24 |
| `tr-b2-compound-past-hikaye:translation` | 49 → **29** | 50 |
| `tr-b2-compound-past-hikaye:cloze` | 45 → 45 | 50 (no surplus variant) |

Verified: captured 26, demoted 26, still-approved 0, all `pool-hygiene` — so
learners keep credit and no `backfill:mastery` rebuild is needed.

The numbers are small because these cells already sat **below** target; `need`
here is driven by variant deficit rather than by surplus, and
`tr-b2-compound-past-hikaye:cloze` had no over-quota variant to take from at all.
