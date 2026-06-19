# Progress & Coach Redesign — Error Stream as the Spine

**Status:** proposal · **Author:** design discussion, 2026-06-19 ·
**Branch:** `feat/improved-progress-tracking-and-display`

Supersedes the narrow framing of [`coach-panel-design.md`](./coach-panel-design.md)
and extends [`progress-tracking.md`](./progress-tracking.md). The coach-panel
doc proposed a *within-session, client-side* error tracker; this doc argues the
error data is richer and more durable than that, and should become the shared
spine for the coach, the debrief, the history tab, and "what to drill next."

---

## The core finding

We grounded this in real data — the author's own Turkish A1 account
(`user_3CvvDOctAr1H2lNK0TNZXDPdD4N`), **334 graded answers over 33 days**
(2026-05-17 → 2026-06-19), queried from the production Neon branch.

**The mastery radar and the stored error log tell contradicting stories, and
the error log is the truthful one.**

Every submission already persists structured errors in
`user_exercise_history.response_json.evaluation.errors[]` —
`{ type, severity, text, correction, explanation }`. Across this account there
are **~117 logged errors with corrections**. Almost none of it reaches a screen.

Ranking grammar points by *displayed mastery* vs. by *errors actually made*:

| Grammar point | Mastery shown | Evidence (attempts) | Major errors in answers |
|---|---|---|---|
| `tr-a1-plural-suffix` | **1.00** 🟢 | 2 | **8** |
| `tr-a1-vowel-harmony` | **0.85** 🟢 | 1 | **8** |
| `tr-a1-locative` | **1.00** 🟢 | 3 | **6** |
| `tr-a1-accusative-definite-object` | 0.41 🟡 | 4 | 10 |
| `tr-a1-personal-suffixes` | 0.34 🟡 | 3 | 7 |

Three of the user's **greenest** points are where they make the **most** real
mistakes. The cause is structural: mastery is computed only from exercises whose
**primary** `grammarPointKey` is that point
(`infra/lambda/src/lib/progress-aggregation.ts`). But vowel harmony, plural, and
case-suffix errors happen *incidentally* inside translation drills tagged with a
different primary point. **The error analysis sees those slips; the mastery model
is blind to them.** So the flagship "honest skill numbers" view shows confident
green built on 1–3 data points while ignoring 44 major grammar errors.

That is the redesign thesis in one line: **promote the error stream from
invisible byproduct to the spine of feedback; demote the radar to a
confidence-gated supporting view.**

---

## Supporting findings (all from the same account)

1. **Practice is lopsided, the radar hides it.** 96% of practice is translation
   (202) + cloze (118). Dictation = 4, vocab-recall = 9, conjugation = 1,
   speaking/reading = **0**. Yet the radar shows a tall **listening** peak driven
   entirely by **4 dictations**. The 6-axis shape is largely an artifact of
   fixed axes over two real activities.

2. **Mastery is overconfident and not confidence-gated.** 20 of 29 grammar
   points read ≥0.80 ("mastered") on an **average of 2.5 attempts**; 10 are green
   off a **single** answer. `progress-tracking.md` explicitly promises
   confidence-gating ("estimated B1, based on 6 exercises" vs "47"); the UI does
   not do it.

3. **The topic taxonomy is noise.** `topicHint` is free-text LLM output
   (`packages/ai/src/generate.ts`, optional, unconstrained). The account has
   **~100 distinct topic strings for 334 attempts** — `"food and drink"` /
   `"food & drink"` / `"food / drink"` and `"home / daily life"` /
   `"daily life / home"` are all separate. **129 of 334 are literally
   `"mixed"`.** The heatmap's "Shopping 77%" is accuracy over **9 noisy
   attempts**, and **nothing lets the user drill a topic.** The heatmap
   visualizes a taxonomy that doesn't exist and can't be acted on.

4. **The debrief is cluttered with non-events.** "Grammar points moved" shows a
   wall of `0% → 0% (+0)` rows for points that were merely present in the
   session but never answered — drowning the one row that actually moved.

5. **The review summary leaks scheduler internals.** "interval 0d→24d,
   stability 2.3→24.0, state learning→mature" exposes raw FSRS fields. Only
   "next in ~24 days" carries user-facing meaning.

6. **History is empty, fluency is near-empty.** History is a "coming soon"
   placeholder despite 33 days of timestamped scores+errors sitting in the DB.
   Fluency has 8 attempts (one bar) — fine, it just needs volume.

7. **Targeted practice is feasible today.** `exercises.grammarPointKey` is
   indexed (`poolLookupIdx`: language/difficulty/type/grammarPointKey,
   approved-only). `POST /sessions` simply doesn't expose a grammar-point filter.
   `RecommendedDrillCard` already detects the weakest axis but links to a generic
   `/drill?start=quick`. The plumbing for "drill this point" is small.

---

## The reframe

The error stream is a **denser, more truthful, already-stored signal** than the
mastery radar. It is cross-cutting (catches incidental slips the single-tag
model misses), longitudinal (timestamped across weeks), and maps directly to the
one question the product exists to answer: *what should I fix next.*

We build **one system** with the error stream as its spine, feeding four
surfaces:

```
                    ┌─────────────────────────┐
   evaluation  ───► │   error observations    │  (normalized, queryable)
   (per answer)     └───────────┬─────────────┘
                                │
        ┌───────────────┬───────┴───────┬────────────────┐
        ▼               ▼               ▼                ▼
     COACH           DEBRIEF         HISTORY        WHAT TO DRILL
  recurring        real slips,     fixed vs.       drill the suffix
  mistake +        no 0%→0%        still-          you keep dropping
  correction       clutter         recurring       (targeted session)
```

And we **fix the radar's honesty** in the same pass, so the supporting view
stops contradicting the spine.

---

## Data model — the one new primitive

Today errors live only inside `user_exercise_history.response_json` (JSONB).
Reading them requires `jsonb_array_elements` scans — fine for a one-off query,
too expensive to power four live surfaces.

**Proposal: materialize an `error_observations` table**, written at evaluation
time (the evaluator already produces the errors; we just persist them
normalized):

```sql
error_observations (
  id, user_id, language,
  exercise_id, session_id, exercise_history_id,
  exercise_type,                  -- where it happened
  host_grammar_point_key,         -- the exercise's primary tag
  error_grammar_point_key,        -- NEW: the point this error is ABOUT (see below)
  error_type,                     -- grammar | vocabulary | spelling | pragmatics
  severity,                       -- major | minor
  wrong_text, correction,
  occurred_at
)
-- indexes: (user_id, language, occurred_at), (user_id, error_grammar_point_key)
```

### The key enrichment: attribute each error to a grammar point

To fix the "incidental slip is invisible" problem (and the radar honesty
problem), each error needs to name *which* grammar point it violates, not just
`type: "grammar"`. `progress-tracking.md`'s own sample JSON already imagined this
(`"point": "past_subjunctive_es"`), but the live evaluator doesn't emit it.

**Decision required (D1):** how to populate `error_grammar_point_key` —
- (a) Add a controlled `grammarPointKey` field to each error object in the
  evaluation prompt's output schema (a prompt change + version bump per
  `CLAUDE.md`), letting Claude tag the violated point from the curriculum; or
- (b) Infer client/server-side from `error_type` + surface heuristics (cheaper,
  lossier); or
- (c) Ship the table now tagged only with `host_grammar_point_key` + `error_type`
  and add per-error attribution in a later phase.

Recommendation: **(a)** — it's the only option that actually fixes the radar
contradiction, and it's a contained prompt change. Phase it so the table lands
first (c-shaped) and attribution upgrades in place.

---

## Surface-by-surface

### 1. Coach — recurring mistake + correction

Replace the canned `coachMessage()` string with the user's top *recurring* error
drawn from `error_observations` (within-session first, falling back to
trailing-window cross-session). Example, straight from this account's data:

> **Watch:** you've used the locative for motion 6 times — `pazarda → pazara`.
> The dative `-(y)A` marks *destination* with `gitmek`.

This is the "skill-based, evidence-based" promise made visible. The coach-panel
doc's Phase 1 (client-side, within-session) becomes a *special case* of reading
the same spine.

### 2. Debrief — real slips, no `0% → 0%` clutter

"What moved" already computes before/after bands
(`infra/lambda/src/lib/debrief/skill-movements.ts`). Two changes:
- **Drop non-events:** never render points that didn't move *and* have no
  evidence (the `0% → 0%` rows).
- **Add a "what slipped, and why" block** sourced from this session's
  `error_observations`, with the correction — not just a red ▼.

### 3. History — fixed vs. still-recurring

The unimplemented tab becomes the longitudinal payoff:
- **Skill/CEFR trend** over 30/60/90/all (the sparklines already stubbed).
- **Error-resolution view:** for each recurring error theme, "first seen → last
  seen → trend." Did the locative-for-motion slip actually decline across weeks,
  or is it still live? This is the true mastery story and it's fully backed by
  timestamped data we already have.

### 4. What to drill next — targetable, replaces the heatmap

Per the decision to **replace the heatmap with targetable drills**:
- **Remove** the topic × recency heatmap and its misleading per-topic % / "hottest
  / coldest topic" cards. Topic is free-text noise and isn't selectable.
- **Replace** with a **growth-zone feed** keyed on grammar points (the real
  controllable axis), ranked by `error_observations` frequency × recency ×
  confidence gap — surfacing "the 3 things to fix next," each a **one-tap
  targeted drill.**
- **Wire targeting:** add `grammarPointKey` to `CreateSessionRequest`, filter the
  pool selector in `POST /sessions` (`poolLookupIdx` already supports it), and
  point `RecommendedDrillCard` + the new feed at it instead of
  `/drill?start=quick`.

This also retires the dependence on `topicHint`; if topical variety is still
wanted for *generation* diversity, that's a separate concern from *user-facing
targeting* and shouldn't drive a UI surface.

### 5. Radar — confidence-gate it (stop it contradicting the spine)

- **Show confidence**: visually distinguish "green on 1 attempt" from "green on
  20." Thin evidence renders muted / hatched, not solid.
- **Absorb incidental errors**: once `error_grammar_point_key` exists, feed
  incidental slips into the mastery fold so vowel-harmony/plural/case stop
  reading as mastered while generating the most errors.
- Keep the radar as a *supporting* shape view, not the headline.

### 6. Review summary — hide the scheduler internals

Collapse "interval / stability / difficulty / state" to a single human line
("next review in ~24 days · getting solid"). Keep the raw FSRS fields behind an
optional "details" affordance at most.

---

## Phasing

**Phase 1 — the spine + the two cheapest payoffs.**
`error_observations` table (host-tagged, option (c)); write on evaluation;
backfill from existing `response_json`. Rebuild the coach to read it; de-clutter
the debrief. No prompt change yet.

**Phase 2 — targetable drills replace the heatmap.**
`grammarPointKey` on `CreateSessionRequest` + pool filter; growth-zone feed;
retarget `RecommendedDrillCard`; remove the heatmap tab.

**Phase 3 — honesty + history.**
Add per-error `grammarPointKey` attribution (prompt change, option (a),
version-bump per `CLAUDE.md`); fold incidental errors into mastery; confidence-gate
the radar; ship the History error-resolution + trend view.

**Phase 4 — polish.**
Review-summary cleanup; LLM-narrated coach phrasing (metered), reading the same
selected error so only the *wording* is generative.

---

## Open decisions

- **D1 — RESOLVED.** Per-error grammar-point attribution lands in two steps:
  ship `error_observations` host-tagged first (option c), then add a controlled
  `grammarPointKey` field to the evaluation prompt's output schema in Phase 3
  (option a, with the version bump required by `CLAUDE.md`).
- **D2 — RESOLVED.** Backfill: replay all existing
  `user_exercise_history.response_json` into `error_observations` at migration
  time, so History and the coach are non-empty for existing users from day one.
- **D3** — coach selection rule when several errors recur: most frequent? most
  severe? weighted by CEFR level of the point? (Inherited open question from
  `coach-panel-design.md`.)
- **D4** — growth-zone ranking weights (error frequency vs. recency vs.
  confidence gap) and how many items to surface.
- **D5 — RESOLVED.** `topicHint` is removed from every user-facing surface. It
  stays in the generation schema **only** as a diversity hint for the generator;
  no UI reads it, and it is never presented as a targetable axis.
- **D6** — pool-depth guardrail: what to do when a targeted point has too few
  approved exercises to fill a session (fall back to mixed? generate on demand?).

---

## Files in scope (reference)

- Spine: `packages/db/src/schema/progress.ts` (new `error_observations`),
  evaluation write path in `infra/lambda/src/routes/exercises.ts`.
- Coach: `apps/web/lib/drill/coach-messages.ts`,
  `apps/web/app/(dashboard)/drill/_components/coach-rail.tsx` /`coach-card.tsx`.
- Debrief: `infra/lambda/src/lib/debrief/skill-movements.ts`,
  `apps/web/app/(dashboard)/drill/debrief/_components/skill-movements-panel.tsx`.
- Targeting: `infra/lambda/src/routes/sessions.ts` (`POST /sessions`),
  `apps/web/app/(dashboard)/progress/_components/shape-side-cards.tsx`
  (`RecommendedDrillCard`).
- Heatmap removal: `infra/lambda/src/routes/progress.ts` (`/progress/heatmap`),
  `apps/web/app/(dashboard)/progress/_components/heatmap-tab.tsx`.
- Radar honesty: `infra/lambda/src/lib/progress-aggregation.ts`,
  `apps/web/app/(dashboard)/progress/_components/shape-tab.tsx`.
- Attribution prompt: `packages/ai/src/prompts.ts`
  (`EVALUATION_SYSTEM_PROMPT` + version bump).
- History: `apps/web/app/(dashboard)/progress/_components/history-tab.tsx`.
