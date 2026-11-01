# Theory page repairs — 2026-11-01

233 of the 312 approved theory pages were repaired by targeted edits (not regeneration):

1. **Round 1** — every audit finding (`../page-findings/`) re-verified against the reference
   grammar and fixed; pages aligned with the corrected curriculum (#804).
2. **Round 2** — all 312 pages re-checked by the new theory validator (Sonnet 5.5 + thinking,
   #805): 194 factual-error claims, each verified against the book — ~171 real (fixed),
   ~15 overstated, ~9 wrong (left unchanged).
3. **Round 3** — re-validation left 53 claims on 40 pages; 44 real (fixed), the rest
   overstated/wrong.

After round 2 the validator rejected 40/312 pages (round 1: 108); the 37 pages changed in
round 3 re-validated with 1 rejection, whose remaining claims were judged overstated and hedged.
Validator verdicts vary between runs on borderline pages, so its claims were never applied
without verification.

- `roundN/<SLICE>.json` — the patch (ops: replace / set / insert / remove; see `apply_patch.py`).
- `roundN/<SLICE>.notes.md` — per finding / claim: verdict, what changed, § source.
- `before.json.gz` — the 233 pages as they were in prod (id, key, md5, review_status, content).
  **This is the rollback artifact.**
- `after.json.gz` — the content written.
- `build_sql.py` — emits one guarded `UPDATE` per page: matches id + key + the exported
  `md5(content_json::text)`, sets `review_status = 'manual-approved'`, clears
  `flagged_reasons`, stores the validator score, and `RETURNING`s the key.

Rollback for one page: restore its `content` from `before.json.gz` (and `review_status`).
