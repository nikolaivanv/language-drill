# TR 3pl predicate determinacy — the generation half (2026-11-21)

Follow-up to **#818**, which fixed the *evaluator* half of this defect and
hand-patched 56 approved rows. This closes the hole that produced those rows.

## The gap

`generation-prompts.ts` already carried the rule — but scoped to one point:

> **Turkish personal/copular-suffix clozes** […] **3pl -lAr is optional and
> HUMAN-only** […] `acceptableAnswers` MUST list every natural form

That bullet fires only when the cell's grammar point *is* `tr-a1-personal-suffixes`.
Every **verbal** point — negation, present continuous, dili past, future, aorist,
past continuous, the compound tenses — got no such instruction, so the generator
keyed `Onlar … temizlemiyorlar` with an empty `acceptableAnswers`. 35 approved
cloze rows and 21 translations shipped that way and had to be patched by hand.

The validator could not catch it either: its determinacy family covered Spanish
tense, polarity, lexeme and clitic-doubling, but had nothing for Turkish predicate
agreement.

## The change

- **`generate@2026-11-21`** — new bullet *Turkish 3pl predicate determinacy*,
  generalising the copular rule to every predicate, verbal or nominal. Two cures,
  preference-ordered: **(a) drop the subject** (with no overt subject `-lAr` is the
  only correct form, so the blank is determinate *and* still drills 3pl), or
  **(b) enumerate the counterpart** in `acceptableAnswers`. Carve-out for non-human
  plural subjects, where the bare predicate is the only natural form and `-lAr` on a
  nominal predicate is an error rather than a rival. Covers translations too.
- **`validate@2026-11-21`** — mirrored bullet *Turkish 3pl-predicate-determinacy*,
  shaped on the existing Spanish clitic-doubling rule: `ambiguous = true` unless
  `acceptableAnswers` lists the counterpart. Same inverted polarity (enumeration IS
  the cure, so flag only its absence), and an explicit instruction not to fail
  `grammarPointMatch` or dock `qualityScore` over the draft's choice of form —
  both forms being correct is the whole point.
- 5 new cases in `validator-ambiguity-cases.json` (2 `ambiguous`, 3 `clean`), drawn
  from the real pre-repair pool rows, so the class is a permanent regression fixture.
- The validator template's size ceiling moved 21000 → 22750. The bullet was **cut
  first** (one worked example instead of three, carve-outs compressed, ~730 bytes),
  and the ceiling then raised with ~1.1KB headroom, per the convention documented
  on that test.

## Verification

### Validator — paired A/B, one variable

`main`'s template vs this branch's, same production validator model, same cases,
rendered through the harness's own `renderValidatorSystemPrompt`:

| case | want | main | branch |
|---|---|---|---|
| `Onlar her sabah kahvaltı ___ (ye-)` → `yemiyorlar`, no list | ambiguous | true, but for an unrelated reason (aorist `yemezler`) | **true, naming `-lAr`** |
| `Öğrenciler sınıfta ___ (dinle-)` → `dinlemiyorlar`, no list | ambiguous | **false** — missed | **true** |
| same, with `acceptableAnswers: ["yemiyor"]` | clean | false ✓ | false ✓, no spurious flags |
| `Dün okula zamanında ___ (gelmek)` (no overt subject) | clean | false ✓ | false ✓ |
| `Kediler çok ___ (küçük)` (non-human subject) | clean | false ✓ | false ✓ |

The discriminating case is the second. Main's own note on it is telling — it
*observed* the problem and still passed the draft: "Plural subject with 3sg verb
(dinlemiyor) is possible in Turkish and is not accepted; minor risk." The new rule
promotes that observation to a verdict. No false positives on the three clean cases.

### Generator — two `eval:gen` runs, baseline = main's template

```
pnpm --filter @language-drill/ai eval:gen \
  --baseline file:<main's GENERATION_SYSTEM_PROMPT_TEMPLATE> --candidate repo \
  --dataset-file scripts/fixtures/cells-tr-3pl.json --drafts-per-cell 5
# replication: same, --limit 2 --drafts-per-cell 8
```

| run | cell | baseline | candidate |
|---|---|---|---|
| 1 (5 drafts) | `tr:a1:cloze:tr-a1-negation` | 40% approved, 3 `ambiguous` | **100%, 0** |
| 1 | other 3 cells | 100% | 100% (no regression) |
| 2 (8 drafts) | `tr:a1:cloze:tr-a1-negation` | 25% approved, 6 `ambiguous` | **88%, 1** |
| 2 | `tr:a1:cloze:tr-a1-present-continuous` | 100% | 100% (no regression) |

Pooled on the moving cell: baseline 4/13 approved, candidate 12/13; `ambiguous`
9 → 1. Cost $1.24 + $1.10. Note both arms validate with the **production**
validator (`eval:gen` cannot exercise a validator change), so this measures the
generator edit alone — the new validator rule is verified separately above.

### Generator — draft shapes, the mechanism

Approval rate alone could move for unrelated reasons, and `eval:gen` does not
persist draft content outside `--pool-history`, so six drafts were generated per
arm for `tr-a1-negation` and read directly. Every branch draft with an overt plural
human subject carried the counterpart:

```
branch:  çocuklar dışarıda ___ (oynamak) -> oynamıyor   acc=["oynamıyorlar"]
branch:  çocuklar bugün dışarıda ___     -> oynamıyor   acc=["oynamıyorlar"]
main:    (no overt plural subject in its six drafts; its pool evidence is the
          56 rows patched in #818, all keyed -lAr with an empty list)
```

## After merge

Both templates are Langfuse-served: run `push-prompts` per environment, as #818 did.
The rule is **inert until exercise generation resumes** — paused in prod since
2026-10-21 (#801) — which is exactly why it was worth landing now rather than under
time pressure when generation restarts.
