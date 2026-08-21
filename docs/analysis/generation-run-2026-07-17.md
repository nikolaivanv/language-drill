# Generation Run Analysis — 2026-07-17

_Source: prod Neon branch `br-green-waterfall-ancrvpr5` (project `twilight-smoke-01114337`), `generation_jobs` + `exercises`. Live API probe run 2026-07-17._

## TL;DR

The run **died of a billing failure, not a quality failure**. The Anthropic credit balance ran out at **04:12 UTC**, mid-run. 17 cells had already completed — at the **best quality in the recent window** (82% approval of requested). The remaining **43 cells failed with `produced=0`**, losing ~**1,350 requested exercises**.

**The account is still out of credit as of this writing** (verified by live API probe). That means answer evaluation and read-annotation are **also down for users right now**, and tomorrow's 04:00 UTC run will fail in full unless credits are topped up.

This is the **second billing outage in five days** — 2026-07-13 lost 54 cells to a *different* billing control.

---

## Run overview

One scheduled run at **04:00 UTC**, **60 cells**, **$16.15** spent.

| | Cells | Requested | Produced | Approved | Flagged | Rejected | Dedup given up | Cost |
|---|---|---|---|---|---|---|---|---|
| `succeeded` | 17 | 810 | 893 | 661 | 79 | 67 | 20 | $16.15 |
| `failed` | **43** | **1,350** | **0** | 0 | 0 | 0 | 0 | — |

### Timeline

| Time (UTC) | Event |
|---|---|
| 04:00:16 | First cell starts |
| 04:00–04:12:48 | 17 cells complete normally, $16.15 spent |
| **~04:12:15** | **Credit balance exhausted — first `400 invalid_request_error`** |
| 04:12:15–04:14:31 | Remaining 43 cells fast-fail (~2 min, no partial output) |

All 43 failures carry the identical error:

> `400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}`

The 17 survivors are simply whichever cells ran before the cutover — there is **no quality signal** in which cells succeeded.

---

## Still-live incident

A minimal probe against the API key in `.env` **right now** returns the same 400:

```
HTTP 400 — "Your credit balance is too low to access the Anthropic API."
```

Credit exhaustion is **account-level**, so this is not confined to generation. Currently broken for users:

| Surface | Impact |
|---|---|
| `POST /exercises/:id/submit` (answer evaluation) | **502** — the core loop of the app |
| `POST /read/annotate` + `/annotate-span` | Broken |
| Tomorrow's 04:00 UTC generation run | Will fail in full |

Today's `usage_events` are empty, so no user actually hit the failure — but that is luck (single-user traffic), not resilience.

**Required action: top up credits in the Anthropic console.** Nothing in the codebase can work around this.

---

## The 43 lost cells

Grouped by what was lost. All will be retried automatically — see recovery below.

| Lang | Level | Type | Cells | Exercises lost |
|---|---|---|---|---|
| tr | a2 | translation | 6 | 180 |
| es | a2 | translation | 5 | 150 |
| tr | b1 | translation | 3 | 150 |
| es | a1 | cloze | 7 | 145 |
| es | a1 | translation | 6 | 125 |
| tr | a2 | cloze | 4 | 120 |
| tr | b1 | cloze | 2 | 100 |
| es | b2 | translation | 2 | 100 |
| es | a2 | cloze | 3 | 90 |
| es | b1 | cloze | 1 | 50 |
| tr | b1 | sentence_construction | 1 | 50 |
| tr | a1 | cloze / translation / conjugation | 3 | 90 |
| | | **Total** | **43** | **1,350** |

### Recovery: automatic, no curriculum bump needed

Confirmed in code, not just by convention — `loadMostRecentSucceededJobPerCell` (`infra/lambda/src/generation/recent-jobs.ts`) filters `WHERE status = 'succeeded'`:

```sql
SELECT DISTINCT ON (cell_key) ...
FROM generation_jobs
WHERE status = 'succeeded'
ORDER BY cell_key, started_at DESC
```

A `failed` row is **invisible** to `decideEnqueue`, so it can neither trigger `skip-low-yield` (which needs `recentJob.approvedCount < 3`) nor `skip-saturated-dedup`. The 43 cells re-enqueue on the next tick with their prior state intact.

**So: restore credit → the backlog clears itself at the next 04:00 UTC run.** No `CURRICULUM_VERSION` bump, no manual trigger. (Contrast with a *low-yield-suppressed* cell, which does need a bump.)

---

## Quality of the 17 cells that ran — the best of the window

Ignoring the outage, this was a **strong** run: **82% approval of requested** (661/810), median cell 87%.

| Cell | Req | Appr | Appr% of req | Flag | Rej |
|---|---|---|---|---|---|
| `es:a2:cloze:es-a2-gustar-type-verbs` | 30 | 29 | **97%** | 1 | 0 |
| `es:b1:translation:es-b1-imperative-negative-pronouns` | 50 | 47 | 94% | 2 | 1 |
| `es:b1:cloze:es-b1-nominalizers` | 50 | 47 | 94% | 2 | 1 |
| `es:b1:translation:es-b1-collective-agreement` | 50 | 46 | 92% | 0 | 4 |
| `es:b1:cloze:es-b1-adjective-de-infinitive` | 50 | 45 | 90% | 5 | 0 |
| `es:b2:cloze:es-b2-nosotros-imperative` | 50 | 45 | 90% | 4 | 1 |
| `es:b1:translation:es-b1-nominalizers` | 50 | 44 | 88% | 0 | 6 |
| `es:b2:cloze:es-b2-aspectual-se` | 50 | 44 | 88% | 6 | 0 |
| `es:a2:cloze:es-a2-imperative-affirmative` | 30 | 26 | 87% | 3 | 1 |
| `es:b2:cloze:es-b2-subjunctive-negated-opinion` | 50 | 43 | 86% | 5 | 2 |
| `tr:b1:sentence_construction:tr-b1-abstract-postpositions` | 50 | 41 | 82% | 5 | 4 |
| `es:b1:cloze:es-b1-imperative-negative-pronouns` | 50 | 40 | 80% | 8 | 2 |
| `tr:b1:sentence_construction:tr-b1-when-converbs` | 50 | 37 | 74% | 13 | 0 |
| `es:b1:translation:es-b1-adjective-de-infinitive` | 50 | 37 | 74% | 1 | 12 |
| `tr:b1:translation:tr-b1-abstract-postpositions` | 50 | 34 | 68% | 0 | 16 |
| `tr:b1:cloze:tr-b1-reason-digi-icin` | 50 | 31 | 62% | 6 | 10 |
| `tr:b1:sentence_construction:tr-b1-reason-digi-icin` | 50 | 25 | **50%** | 18 | 7 |

Notable: the **ES B2 cells clear 86–90%**, and the ES B1 book-coverage points added in #585 (`nominalizers`, `adjective-de-infinitive`, `collective-agreement`) are landing at 74–94%. The new ES/TR curriculum work is generating cleanly.

### Flag tags across the run

| Tag | Count |
|---|---|
| `validator-note` | 283 |
| `low-quality-flag` (route tag) | 77 |
| `ambiguous` | 50 |
| `grammar-point-mismatch` | 7 |
| `level-mismatch` | **3** |

`level-mismatch` at 3 across the whole run confirms the #338 improvement has held. `ambiguous` remains the dominant substantive reason, exactly as in the June run.

### The one weak cell: `tr-b1-reason-digi-icin` (sentence_construction)

Sole cell below 60%, and it concentrates the run's ambiguity:

| Cell | `ambiguous` flags |
|---|---|
| `TR:B1:sentence_construction:tr-b1-reason-digi-icin` | **16** (of 18 flagged) |
| `TR:B1:sentence_construction:tr-b1-when-converbs` | 7 |
| `ES:B1:cloze:es-b1-imperative-negative-pronouns` | 6 |

The same grammar point in **cloze** form scored 62% with only 3 `ambiguous` — so the ambiguity is specific to the *sentence_construction* surface for `-dığı için`, not to the point itself. Worth an `eval:gen` A/B if it repeats; a single run at 50% is not yet strong evidence.

---

## Recurring billing failures — the real finding

Two of the last five runs were destroyed by billing, via **two different controls**:

| Day | Cells lost | Failure |
|---|---|---|
| **2026-07-13** | **54** | `"You have reached your specified API usage limits. You will regain access on 2026-08-01 at 00:00 UTC."` — a **configured spend cap** in the Anthropic console |
| 2026-07-14–16 | 0 | Healthy (cap evidently raised / credits added) |
| **2026-07-17** | **43** | `"Your credit balance is too low"` — **prepaid credit exhausted** |

These are distinct settings and **both** need headroom: raising one does not protect against the other.

### Spend context

| Day | OK | Failed | Approved | Cost |
|---|---|---|---|---|
| 07-17 | 17 | **43** | 661 | $16.15 |
| 07-16 | 60 | 0 | 237 | $9.34 |
| 07-15 | 60 | 0 | 129 | $8.46 |
| 07-14 | 60 | 0 | 159 | $11.24 |
| 07-13 | 6 | **54** | 23 | $2.05 |
| 07-12 | 60 | 0 | 296 | $16.64 |
| 07-11 | 60 | 0 | 340 | $18.70 |
| 07-10 | 60 | 0 | 455 | $23.39 |
| 07-09 | 60 | 0 | 1,425 | $42.00 |
| 07-08 | 212 | 0 | 1,498 | $65.28 |
| 07-07 | 187 | 0 | 4,355 | $117.14 |

Steady state is **$8–23/day**; curriculum-launch days spike to **$42–117**. Roughly **$330 over 11 days**. Today's survivors cost ~$0.95/cell against 50-count requests, so the **full 60-cell run would have been ~$45–55** — and the next run carries today's 43-cell backlog on top of normal top-ups, so **budget ~$50–60 for the recovery run**, not the $9 that 07-16 cost.

### Monitoring gap

Both outages were caught **only by manual inspection, days late**. Nothing alerts on this:

- The CDK **AWS Budget** covers AWS spend — Anthropic is billed separately and is invisible to it.
- `AI_KILL_SWITCH` / `AI_GLOBAL_DAILY_CAP` cap *our* usage events; they don't observe the provider's balance.
- A failed generation job writes `error_message` to the DB and moves on. **No alarm, no notification.**
- Lambda `Errors` metrics don't fire either — the job catches the error and records `status='failed'` cleanly.

A run can therefore lose 70% of its cells and look, from every dashboard, like nothing happened.

---

## Recommendations

1. **Top up Anthropic credits now.** This is a live user-facing outage (evaluation → 502), not just a generation problem. Nothing else on this list matters until it's done.
2. **Raise/verify both billing controls, not one.** Check the prepaid credit balance *and* the configured monthly usage limit (the 07-13 failure said access returns 2026-08-01 — confirm that cap is above expected burn). Size for **~$25/day steady + launch-day spikes to ~$120**, plus ~$50–60 for the recovery run.
3. **Enable auto-reload** on the Anthropic account if available — it removes this failure mode entirely rather than monitoring for it.
4. **Alarm on failed generation jobs.** The cheapest real fix: the scheduler/consumer already knows the cell failed. Emit a CloudWatch metric on `status='failed'` and alarm when a run's failure count exceeds a threshold (e.g. >5 cells). Today's 43/60 would have paged at 04:12 instead of being found by hand.
5. **Classify billing errors distinctly.** `credit balance is too low` and `reached your specified API usage limits` are both `400 invalid_request_error` — they are unretryable, whole-account failures, and worth failing the *entire* run fast with a distinct log/metric rather than letting 43 cells each burn their own failing request.
6. **Watch `tr-b1-reason-digi-icin` sentence_construction** on the recovery run. If 50% / 16-`ambiguous` repeats, run `eval:gen` against it. One run is not yet a trend.

No action needed to recover the 1,350 lost exercises — the scheduler ignores `failed` rows, so the cells re-enqueue on the next tick once credit is restored.
