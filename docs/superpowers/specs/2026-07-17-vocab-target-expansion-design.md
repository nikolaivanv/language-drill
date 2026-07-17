# Curated Vocab-Target Expansion — All Levels + DE

**Date:** 2026-07-17
**Status:** Approved (design), pending implementation
**Prior art:** PRs #545 (ES A1 authoring pipeline), #549 (browse hub / coverage read model), #556 (seeded `vocab_recall` generation), #563 (parameterized authoring, TR A1 activation).

## Goal

Extend the curated vocab-target machinery — currently live for **ES A1** and
**TR A1** only — to every enabled `(language, level)` scope: **ES/TR/DE ×
A1–B2**. End state: each scope has a full themed-umbrella set in the
curriculum and an approved curated target pool, and the nightly scheduler
converges `vocab_recall` coverage onto those targets.

## Background

The pipeline is already fully parameterized and data-gated:

- `pnpm --filter @language-drill/db generate:vocab-targets --language X --level Y`
  proposes ~30 words per vocab umbrella via Claude, structurally validates,
  joins `vocab_lemma` corpus frequency, inserts `status='flagged'` rows.
- `pnpm review:flagged-vocab [--language X] [--approve-all]` promotes to
  `approved`.
- The ~04:00 UTC scheduler computes `need = |uncovered targets|` per vocab
  cell; converges in ~1–2 nights per scope.

Activating a new scope is therefore **authoring data, not code** — provided
the scope has vocab umbrellas in the curriculum. Current umbrella inventory:

| | A1 | A2 | B1 | B2 |
|---|---|---|---|---|
| **ES** | 5 (curated) | 5 | 1 broad | 1 broad |
| **TR** | 5 (curated) | 5 | 5 | 0 |
| **DE** | 0 | 1 broad | 1 broad | 1 broad |

## Decisions

1. **Scope: full parity.** Author themed umbrellas wherever missing; curate
   every scope A1–B2 in all three languages.
2. **Existing broad umbrellas are kept**, each counting as one of its
   level's themes (no key removals — avoids orphaned exercises and progress
   rows).
3. **Rollout: hybrid (Approach A).** Data-only curation starts immediately
   for scopes whose umbrellas already exist; a single curriculum PR adds the
   missing umbrellas in parallel; post-merge, the new scopes are curated the
   same way.
4. **Review: triage + spot-check.** Claude triages every flagged list
   (off-level, off-theme, wrong POS, cross-umbrella duplicates) into a short
   report; the user spot-checks per language; then `--approve-all`.

## Part 1 — Curriculum PR (~30 new umbrellas)

Keys follow `<lang>-<level>-vocab-<theme>`. Themes are grounded in the
level's syllabus: PCIC (ES), Yedi İklim (TR), Goethe / Profile Deutsch (DE).
Exact theme wording is finalized against the syllabi during implementation;
counts and structure below are the approved shape.

| Scope | New | Themes |
|---|---|---|
| DE A1 | 5 | family-people, food-drink, home-objects, city-transport, weather-clothing (mirrors ES/TR A1) |
| DE A2 | 4 | work-school, city-shopping, health-body, travel-nature (+ existing `de-a2-housing-vocab`) |
| DE B1 | 4 | media-news, education-career, emotions-relationships, opinions-society (+ existing `de-b1-environment-vocab`) |
| DE B2 | 4 | work-professional, science-technology, society-politics, culture-media (+ existing `de-b2-academic-noun-vocab`) |
| ES B1 | 4 | media-news, education-career, emotions-relationships, opinions-society (+ existing `es-b1-environment-vocab`) |
| ES B2 | 4 | work-professional, science-technology, society-politics, culture-arts (+ existing `es-b2-abstract-noun-vocab`) |
| TR B2 | 5 | work-professional, science-technology, society-politics, culture-arts, global-issues |

**Entry shape:** identical to existing vocab umbrellas — `kind: 'vocab'`,
description, 2 positive / 1 negative example, 2 `commonErrors`. No
theory-categories entry (theory pool is grammar-only).

**coverageSpec policy:** default **none** (matches 11 of the 12 existing
umbrellas). A `wordClass` floor only where an umbrella risks collapsing to
nouns-only and verbs/adjectives matter (precedent:
`tr-a1-vocab-food-drink`). Each umbrella gets an explicit documented
decision per the coverageSpec authoring checklist.

**Ripple items (same PR):**

- `CURRICULUM_VERSION` bump (new cells must enqueue; also clears any
  skip-low-yield suppression).
- `curriculum.test.ts` per-level floor updates (including any pinned
  regex-based counts).
- Book-coverage ledgers untouched — vocab umbrellas don't claim book
  sections; confirm `book-coverage.test.ts` stays green.
- No api-client change (`vocab` kind already in the Zod enum).

## Part 2 — Data rollout

All runs against **prod** `DATABASE_URL` (local `.env` points at the Neon
dev branch — pull the prod connection string explicitly).

**Immediate (pre-merge, existing umbrellas):**

1. **Pre-flight:** verify `vocab_lemma` has usable DE coverage for the
   frequency-anchor join; sanity-check ES/TR bands. Thin DE bands are a
   blocker to resolve (and report) before DE runs.
2. **Author:** `generate:vocab-targets` for ES A2, TR A2, TR B1 — default
   ~30 words per umbrella → `flagged` rows. The existing DE broad umbrellas
   are **deferred to post-merge**: the authoring CLI always proposes ~30 new
   words per umbrella per run, so curating them now and re-running their
   levels post-merge would double-size them (~60 words) relative to their
   new themed siblings (~30). One run per scope, after the scope's full
   umbrella set exists.
3. **Triage → spot-check → approve:** per the review decision above;
   `review:flagged-vocab --approve-all` per language after user OK.
4. **Dedupe sweep (DE):** PR #563's legacy duplicate `vocab_recall`
   demotion covered TR + ES only; run the same audit/demotion for DE so
   seeded generation doesn't stack onto duplicates.

**Post-merge (new umbrellas):** same author → triage → approve cycle for
DE A1 and all newly added umbrellas (DE A2–B2 siblings, ES B1/B2, TR B2).

**Convergence:** nightly scheduler, ~1–2 nights per scope.

## Verification & success criteria

- Coverage read model (Progress → words) shows uncovered target counts
  trending to zero per curated cell.
- Generation-run stats: approval rates in the normal band, no flag-loop
  spike.
- No duplicate-word regression (one canonical `vocab_recall` per word per
  umbrella).
- Transient nightly generation failures self-recover; persistent low-yield
  cells are investigated (not expected for vocab cells).

**Done means:** every ES/TR/DE × A1–B2 scope has an approved curated target
set and converged seeded coverage.

## Out of scope

- EN (not a learning language in the curriculum).
- C1/C2 (no enabled curriculum at those levels).
- Retiring/renaming existing broad umbrellas.
- Changes to the authoring pipeline code itself (already parameterized).
