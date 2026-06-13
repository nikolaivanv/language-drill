# Pool Coverage Controller — Design Proposal

_A proposal for a closed-loop system that measures the approved exercise pool's
distribution per cell and issues targeted generation tasks to correct diversity
deficits. Follow-up to the [pool diversity audit](pool-diversity-audit.md) (#273)
and the person-rotation work (#272 / #275 / #276)._

_Status: proposal. Nothing here is built. Phase 0 is the recommended next step._

---

## The problem this solves

Diversity is a **distributional property of a set**, invisible at the per-item
level. Neither generation-time component can see it:

- The **generator** sees one draft at a time (plus a `recentStems` list); it
  cannot know the cell is already 90% third-person-singular.
- The **validator** scores one draft against the spec; "this draft is fine" is
  true even as the 50th consecutive 3sg draft.

Every diversity fix shipped so far is **open-loop (feedforward)** — it pushes a
directive in at generation time and hopes the resulting pool comes out balanced:

- the `tr-a1-vowel-harmony` batch-coverage rule in the generation system prompt,
- per-draft **person rotation** by ordinal (#272).

Neither *measures* the resulting pool or *corrects* drift. The hand audit in
[`pool-diversity-audit.md`](pool-diversity-audit.md) is precisely the measurement
that is missing — done once, manually, in SQL.

## The proposal in one sentence

Add a **closed-loop controller**: tag each exercise with the coverage value it
realizes, measure the approved pool's per-cell distribution, diff it against a
target, and emit generation tasks for the underfilled buckets on the next run.

The right mental model is **statistical process control**: the generator and
validator are per-unit QC; this is the control chart on the aggregate, with the
coverage floors as control limits, drift as an out-of-control signal, and
targeted generation as the corrective action.

---

## Why it beats what we already have

Person rotation today is **blind ordinal rotation** — it assumes every person
fills equally. We have direct evidence that is false: 2pl/2sg cloze are harder to
generate cleanly and get rejected more often (observed in the #272 pre-merge
eval and the 06-13 run). Blind rotation cannot notice; it just advances to the
next ordinal and moves on, leaving the hard buckets permanently underfilled.

A closed loop measures **what actually landed in the approved pool** and keeps
targeting the persisting deficit. **Self-correction under uneven approval rates
is the thing hand-coded rotation fundamentally cannot do**, and it is the
strongest single argument for the controller. Person rotation becomes a special
case: instead of "rotate person by ordinal," the scheduler says "the approved
pool is short 8 drafts of `2pl` — generate those specifically."

---

## Architecture: validator tags, scheduler controls

Keep each component within its natural scope. Do **not** make either one read
the whole pool with an LLM.

### 1. Validator emits a realized-coverage tag

The validator already reads each draft and returns structured fields
(`ambiguous`, `levelMatch`, `grammarPointMatch`, …). Add one: the value the draft
**realizes** on the cell's coverage axis, e.g. `person: "2pl"`.

- It must be the *realized* value, not the *requested* one — the rotation
  directive has an escape hatch ("use the nearest natural person if the target
  doesn't fit"), so intent ≠ outcome. Only the validator, reading the finished
  draft, knows what was actually produced.
- Persist it as `coverageTags` on the exercise row (`content_json.coverageTags`
  or a dedicated column).

### 2. Scheduler controls

`decideEnqueue` already runs a per-cell loop, queries the approved count, and
emits SQS generation tasks. Generalize it:

- `need` goes from a **scalar** (N more) to a **vector** (N more of
  `person=2pl`, M of `1pl`, …), computed against per-bucket floors.
- The per-bucket target rides in the generation job message as a per-draft
  directive — the exact mechanism `renderPersonBlock` already implements.

### The unlock: tag at generation time, measure with SQL

With `coverageTags` written at generation time, measuring drift is a free
`GROUP BY coverageTags->>'person'`. The alternative — an LLM re-reading the whole
pool every run to classify it — is expensive and slow; **avoid it.** Legacy
untagged exercises need a one-off backfill pass, but only for the cells that
matter.

---

## The hard part is the coverage *spec*, not the mechanism

"What does balanced look like for this cell?" is where the difficulty lives.
Three sources:

1. **Hand-authored per grammar point** (like `personRotation`, but richer:
   `coverageAxes: [{ name: 'person', values: [...], floors: {...} }]`). Precise,
   but does not scale and keeps missing axes — exactly the treadmill the audit
   exposed (person → participle-regularity → word-class → particle-harmony → …).
2. **LLM-derived, human-reviewed.** Ask once per grammar point: "which 1–2
   dimensions should a diverse set vary along, and what is the realistic target
   distribution?" Generalizes to axes nobody enumerated; nondeterministic and
   needs review, but it is computed rarely and cached.
3. **Unsupervised drift detection.** Cluster / feature-extract and flag
   over-concentration with no predefined axis.

**Pure unsupervised (3) is a trap on its own.** Legitimate concentration is
everywhere: `tr-a1-var-yok` is *correctly* ~50/50 var/yok with nothing else;
`es-b1-passive-se` was healthy at 18/31 singular/plural. Without grammar-point
semantics you cannot distinguish "collapsed" from "correctly concentrated," and a
uniform-by-default controller would generate nonsense (forcing 2pl imperatives
that barely exist, forcing literary `-se` past-subjunctives).

**Recommendation:** LLM-proposed + human-reviewed specs (2), enforced
deterministically. Separate the smart-but-expensive part (spec authoring, done
rarely) from the cheap-deterministic part (measure → diff → emit, every run). Use
(3) only as a *discovery aid* to surface candidate axes for humans to spec —
never as a controller.

---

## Risks to design against

1. **Per-bucket doom loop (the big one).** A controller that demands "8 more
   `2pl`" can burn tokens forever if `2pl` is genuinely hard to generate well:
   request → validator rejects → still short → request again. This is the
   low-yield-suppression problem (which already bit us in #275/#276), now
   per-bucket. It **must** have a per-bucket give-up / backoff and a
   "legitimately sparse" escape, or it amplifies the precise cost problem the
   pre-generation pool architecture exists to avoid.
2. **Bucket combinatorics.** person × polarity × sentence-type × tense explodes
   past any realistic per-cell target. Specs must be coarse and prioritized —
   1–2 dominant axes per cell with modest floors, never the full cross-product.
3. **Target legitimacy.** Some concentration is correct; floors and "rare/NA"
   markers, not uniformity-by-default.
4. **Control the right variable.** Measure the *approved* composition (what
   learners actually see), not the *generated* composition.

---

## Staged rollout

### Phase 0 — coverage tags + monitoring ✅ implemented

Validator emits the realized person tag; persist it; surface the per-cell
distribution on the existing `GET /admin/pool-status` endpoint. This alone turns
the one-off manual audit into a standing query.

- **High value, near-zero risk**, and the foundation for everything else.
- Do this **regardless** of whether the controller is ever built — it converts
  pool diversity from "discovered by accident" into a measured quantity.

### Phase 1 — coverage-aware scheduler, person axis only

Replace blind ordinal rotation with deficit-driven targeting + per-bucket
give-up. Contained, testable, validates the whole loop on the one axis whose
infrastructure already exists (#272), and is strictly better than blind rotation.

### Phase 2 — declarative coverage specs

LLM-proposed, human-reviewed, stored in the curriculum (like `personRotation`,
but richer). Generalize the Phase-1 controller to read the spec. A new axis
(word-class for vocab, participle-regularity for compound tenses) becomes a
**data change, not a code change** — directly ending the "we keep discovering
axes" treadmill.

### Phase 3 (optional) — unsupervised discovery

Cluster / feature-extract the pool to surface candidate axes humans have not
specified, feeding Phase-2 spec authoring. A research aid, not a controller.

---

## Do we even need the full thing?

For a 4-language, B1–B2-focused app, the set of high-value axes may be small
enough (person, polarity, a couple of morphophonological axes, word-class for
vocab) that hand-coding 8–10 open-loop rules is tractable and the controller is
overkill. The controller earns its cost specifically when:

- axes are numerous (moderate here),
- **approval rates vary by bucket, so self-correction is needed** (real — measured
  in #272 and the 06-13 run),
- standing observability of pool health is wanted (genuinely valuable — no more
  hand-run audits).

**Bottom line:** do **Phase 0 now regardless** — the measurement is 80% of the
value at 20% of the risk. Decide on the controller (Phase 1+) only once the
monitoring shows how many cells actually drift and how badly. Don't build the
closed loop until the data proves it's needed.

---

## Related

- [`pool-diversity-audit.md`](pool-diversity-audit.md) — the manual audit this
  would automate; the taxonomy of axes (#273).
- Person rotation: #272 (mechanism), #275 / #276 (the curriculum-version bumps
  that were needed to make the scheduler actually re-run the suppressed cells —
  a cautionary tale for any system that emits generation tasks: clearing
  suppression is a real, separate step).
