# TR sentence-construction collapse — measurement, 2026-08-21

**Result: the TR SC pool is NOT collapsed. No demotion is warranted, and none was
run.**

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
