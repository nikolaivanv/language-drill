# Curriculum Authoring — the coverageSpec checklist

_Every new `kind: 'grammar'` point MUST get an explicit coverageSpec decision at
authoring time — either axes+floors, or a one-line reason why none is needed.
This is not optional polish: a point whose description claims a paradigm but
ships without floors **silently collapses** onto the model-default form, and
nobody notices until a learner does._

**Case study (2026-07-17, PR #588):** `tr-a1-imperative` shipped spec-less. Its
description promises three contrasts — 2sg bare stem vs 2pl `-(y)In`, and the
negative `-mA`. The approved pool converged to **100% affirmative, ~95%
bare-stem 2sg** (19 cloze exercises: 18 bare stems, one `bakın`; zero
negatives). Per-item validation can't catch this — every individual draft
looked fine; the failure is distributional. It was found by the app's author
practicing, weeks after the pool filled. The retrofit cost: a curriculum PR +
`CURRICULUM_VERSION` bump + `pnpm demote:pool` on every collapsed cell +
regeneration — versus one field at authoring time.

## The decision procedure

For each axis below, ask: **does the point's own description / examples /
commonErrors claim more than one value of this axis as core content?**

| Axis | Values (closed vocabulary — `packages/shared/src/coverage.ts`) | Typical trigger phrases |
|---|---|---|
| `person` | `1sg 2sg 3sg 1pl 2pl 3pl` (ES: **no `2pl`** — pan-American, vosotros omitted) | "plus personal endings", "across persons", a conjugation table |
| `number` | `singular plural` | "singular and plural", plural suffix, agreement |
| `case` | `nominative accusative dative locative ablative genitive` | two+ cases named (TR ablative/dative, DE Wechselpräpositionen) |
| `polarity` | `affirmative negative` | "negative is …", a negation form with its own morphology |
| `wordClass` | `noun verb adjective adverb other` | point spans word classes (vocab umbrellas) |
| `sentenceType` | `declarative interrogative imperative` | rarely useful — only when clause type varies *within* the point |

A **yes** needs all three of:

1. **Claimed** — the paradigm half is in the point's own text (if it's not core
   content, don't force it).
2. **Collapse-prone** — free generation defaults to the unmarked member: 3sg,
   affirmative, singular, declarative. (Empirical: the 2026-06-12 pool audit
   found every TR tense cell ≥90% 3sg; imperative collapsed on two axes at
   once.)
3. **Form-relevant** — different values produce different target surface forms.
   A meaning-contrast point (preterite-vs-imperfect *usage*, conditional
   conjecture) does not need form floors.

A **no** is fine — most points don't need a spec. Legitimate no's:

- Lexical/invariant points: connectors, fixed postpositions, word order,
  discourse markers.
- Choice-between-competing-words points (ser/estar, por/para): the axis that
  varies is lemma choice, which is not a coverage axis — lexical variety comes
  from seed-word rotation instead.
- Multi-construction / closed-set points where pinning a value makes the task
  ambiguous (precedent: `tr-a2-reported-speech`, see the
  `sentenceConstructionSuitable` notes).
- **Eval-excluded cells** — the 2026-06-12 rotation eval showed some chronically
  weak cells degrade further under person rotation. Test-enforced no-person
  list (see `curriculum.test.ts` "does not give coverageSpec.person…"):
  `tr-a1-var-yok`, `tr-a1-locative`, `es-b1-passive-se`,
  `tr-a2-mis-evidential`, `tr-a2-ability-necessity`. Don't re-add person to
  these without a fresh eval.

**Record the "no".** When a paradigm-looking point deliberately gets no spec,
say why in a comment on the entry — the next auditor (human or agent) shouldn't
have to re-derive it.

## Floors: house style and budget arithmetic

- Cell size: `resolveCellTarget` (`infra/lambda/src/generation/cell-targets.ts`)
  takes `max(base target, largest single-axis floor sum)`. Base targets:
  cloze/translation/sentence-construction A1=20, A2=30, B1/B2=50.
  An axis whose floors sum ≤ the base target is free; exceeding it grows the
  cell (allowed — `tr-a1-degil` person floors sum 30 on an A1 cell — but do it
  deliberately, it costs generation tokens).
- House styles: full person paradigm → 5 per person (TR 6×5=30, ES 5×5=25);
  two-value axis → 6/6 or 8/8; skewed polarity → `{affirmative: 10, negative: 8}`
  (or 18/12 on bigger cells) when affirmative is the natural majority.
- **Partial floors are valid and encouraged** — omitted values are "NA", never
  targeted. `tr-a1-imperative` floors only `{2sg, 2pl}`: 3rd-person commands
  belong to `tr-a2-optative`. Floor only what the point actually owns.
- Give-up safety net: a value requested ≥2× in a batch with zero approvals is
  suppressed until the next `CURRICULUM_VERSION` bump — an unproducible floor
  won't grind the scheduler forever, but don't rely on this as a design tool.

## Wiring facts (why a spec is all you need)

The pipeline is axis-agnostic end to end: the scheduler water-fills per-draft
targets from the floors (`coverage-decision.ts`), the generation user prompt
pins each draft (`renderCoverageBlock`), the validator reports realized values
per axis (instruction blocks + tool enums activate from the spec), and approved
counts feed back per `(axis, value)`. No prompt edits, no new code — the spec
IS the feature. `pnpm propose:coverage-spec --grammar-point <key>
[--with-pool-stats]` drafts a proposal grounded in the current pool if you want
an LLM first pass.

## Retrofitting a spec onto a filled cell

Adding a spec to an existing point does nothing by itself when the cell is at
target: the scheduler's `need = target − approved`, and coverage targets are
only assigned to `need` new drafts. The sequence that works
(runbook-in-miniature, from PR #588):

1. Merge the spec + `CURRICULUM_VERSION_*` bump; wait for the deploy.
2. `pnpm demote:pool -- --language XX --cefr YY --type <type> --grammar-point <key>`
   (dry-run first, then `--apply`; **prod** `DATABASE_URL` — the local `.env`
   points at the dev branch) for every collapsed cell of the point.
3. Next ~04:00 UTC scheduler tick refills the cells under the floors.

Skipping step 2 is the classic trap — the bump clears *suppression*, but an
at-target cell has no deficit, so the floors never fire.

## Authoring-time checklist (append to any new-grammar-point work)

- [ ] For each of the 6 axes: claimed? collapse-prone? form-relevant?
- [ ] Spec written with partial floors where the point owns only part of a
      paradigm — or a comment on the entry saying why no spec.
- [ ] Floor sums checked against the level's base target (grow deliberately or
      stay under).
- [ ] Not on the eval-excluded no-person list.
- [ ] `CURRICULUM_VERSION_*` bumped in the same commit (always required for new
      points anyway).
- [ ] If retrofitting: demote plan for already-filled cells.

## Related

- `docs/pool-coverage-controller.md` — mechanism design (phases, controller)
- `docs/pool-diversity-audit.md` — the 2026-06-13 data audit that motivated it
- `docs/analysis/coverage-spec-audit-2026-07-17.md` — full-curriculum triage of
  every spec-less grammar point (TR + ES; DE pending curriculum re-enable)
- `packages/shared/src/coverage.ts` — axis/value vocabulary
- `infra/lambda/src/generation/cell-targets.ts` — target arithmetic, give-up
