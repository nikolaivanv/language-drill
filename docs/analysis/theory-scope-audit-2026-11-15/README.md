# Theory page scope audit + repair — 2026-11-15

**Trigger:** the TR A1 question-formation page never taught either/or questions or
`acaba`, though the exercises drill both (#814). The 2026-11-01 audit checked each
page's *facts*, not its *scope*. Many pages were generated before their curriculum
entry gained `constructionVariants` / `examplesPositive` / `coverageSpec` values.
The exercise generator follows those fields, and the pages were never regenerated.

## 1. Audit (`scope-report.json`)

`packages/ai/scripts/audit-theory-scope.ts` makes one Sonnet 5.5 (adaptive thinking)
call per page. It compares the page against its curriculum entry (description,
examplesPositive, constructionVariants, coverageSpec values, commonErrors) and lists
every construction the exercises can test that the page does not teach, rating each
`important` or `minor`. Facts, wording and density are explicitly out of scope.

The audit was calibrated on tr-a1-questions: the old page gave exactly the 3 reported
gaps, and the #814 page came back `complete`.

| | Pages | Complete | Minor gaps only | Important gaps |
|---|---|---|---|---|
| DE | 104 | 60 | 30 | 14 |
| ES | 119 | 29 | 15 | 75 |
| TR | 89 | 31 | 17 | 41 |

130 pages had 265 important gaps: 233 absent, 12 mentioned-only, 20 thin. Cost $3.33.

## 2. Repair (`repair-*-report.json.gz`, `after.json.gz`)

`packages/ai/scripts/repair-theory-scope.ts` has Opus 5.5 (adaptive thinking) draft a
patch for each page with important gaps. The patch uses the 2026-11-01 `apply_patch.py`
op format. The patched page must pass four gates, and failures are fed back for up to
4 attempts:

1. the `parseTheoryTopicJson` schema check, plus a mixed-script check;
2. the **production theory validator** (Sonnet 5.5 + thinking): auto-approved, with **zero factual errors**;
3. a **re-run of the scope audit**: no important gaps left;
4. an **edit reviewer** that reads the rendered line diff: no broken splices, no removed
   correct content, no contradictions. Its `out-of-scope` findings are informational only,
   because the formation tables and pitfalls the fact-checker demands always look out of
   scope to it. This gate was added after the pilot, where the first three gates passed a
   mid-sentence splice and a removed correct callout.

The first run passed 123 of 130 pages and a retry of the 7 failures passed 3 more. One
page was overridden by hand (`repair-override-report.json.gz`): **tr-a1-beri-dir**, where
the reviewer's "stray table row" was a row appended to an existing table (a diff-rendering
false positive). The validator auto-approved it at 0.86 with no open gaps. **127 pages
repaired. Repair cost $51.50.**

Retries also corrected several factual errors that were already on the pages (e.g. TR
"bu yüzden always appears at the start of the clause", ES "*entiendo más y más is
unnatural"), because the fact-checker re-reads the whole page.

**Not repaired (gaps still open):** `es-a1-gender-agreement` (its draft contradicted
itself on naranja/naranjas), `es-a2-direct-object-pronouns`, and
`es-a2-tonic-pronouns-prepositions`. The validator kept flagging all three at 0.60–0.66
because of level and density, not factual errors.

## 3. Write

`build_sql.py` emits one UPDATE per page, guarded on `md5(content_json::text)` as exported
before the audit. Each statement sets `review_status = 'manual-approved'`, clears
`flagged_reasons`, stores the final validator score, and `RETURNING`s the key. The
statements ran through the Neon MCP. Afterwards every written page was re-exported and
compared to `after.json.gz`, and all matched exactly.

## Files

- `before.json.gz`: the 127 pages as exported from prod (id, key, md5, review_status, content). **The rollback artifact.**
- `after.json.gz`: the content written (id, key, base_md5, content).
- `scope-report.json`: the audit verdicts and gaps for all 312 pages.
- `repair-report.json.gz` / `repair-retry-report.json.gz` / `repair-override-report.json.gz`:
  every attempt's patch, validator verdict, open gaps and edit-review findings.
- `build_sql.py`: the guarded-UPDATE builder.

Rollback for one page: restore its `content` (and `review_status` / `quality_score`) from
`before.json.gz`, guarded on the md5 of the written content.
