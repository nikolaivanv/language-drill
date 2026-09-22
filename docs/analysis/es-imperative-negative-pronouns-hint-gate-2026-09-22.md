# es-b1-imperative-negative-pronouns — deterministic verb-hint demotion

**Date:** 2026-09-22 · **PR:** #733 · **Neon branch:** `br-green-waterfall-ancrvpr5` (production)

`revalidate:cloze --deterministic-only --apply` writes no rollback artifact, so
the 82 candidate rows' state is captured here **before** the run. This is the
second snapshot of this cell; the first
(`es-imperative-negative-pronouns-revalidate-2026-09-21.json`, PR #730) holds the
state before the LLM repass that preceded it.

`--deterministic-only` never overwrites `quality_score` and never drops existing
`flagged_reasons` — it appends `missing-lexeme-hint` and downgrades
`auto-approved` → `flagged`. So the rollback is: restore `review_status` from the
`before` column below and drop the appended reason.

```sql
-- rollback shape
UPDATE exercises SET
  review_status = v.status,
  flagged_reasons = (
    SELECT COALESCE(jsonb_agg(r), '[]'::jsonb) FROM jsonb_array_elements(flagged_reasons) r
    WHERE r->>'code' <> 'missing-lexeme-hint'
  )
FROM (VALUES ...) AS v(id, status)
WHERE exercises.id = v.id::uuid;
```

## Pre-run state (82 rows: 29 auto-approved, 53 flagged)

`id,review_status,quality_score,flagged_reason_codes`

```csv
133e36d3-b7f6-5daf-a824-12538f01f9a6,flagged,0.62,low-quality-flag|ambiguous|validator-note
164d4616-01b6-56cc-9b14-25902139eff1,flagged,0.55,low-quality-flag|ambiguous|validator-note|validator-note
174d47a9-82d3-5491-9c14-272da01d5220,auto-approved,0.82,
1b3e436b-c0db-5bd7-a024-056b97e6e82e,auto-approved,0.88,
1c4d4f88-fb0a-542e-a514-35b22c581a1b,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note|validator-note
1d4d511b-7c27-51f3-a614-374fab3b7c4a,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note|validator-note
1e3e4824-4431-5526-9b23-fd5a14910ebb,flagged,0.55,low-quality-flag|ambiguous|validator-note|validator-note
1f4d5441-79ee-5669-a414-3415a90240a8,auto-approved,0.82,
204d55d4-f698-5d1a-a914-3c2630ca915f,auto-approved,0.9,
214d5767-77b4-5adf-aa14-3dc3afadf38e,auto-approved,0.82,
224d58fa-f45f-5190-a714-38ec2e9155bd,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note
234d5a8d-757b-5f55-a814-3a89ad74b7ec,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note|validator-note
2aa191f2-74ba-52dc-9db3-f4b0a9c5e299,auto-approved,0.72,
2ca19518-699c-592a-abb4-0b46a78ca6f7,auto-approved,0.85,
2da196ab-eab9-56ef-acb4-0ce326700926,flagged,0.62,low-quality-flag|validator-note|validator-note|validator-note|validator-note
2ea1983e-6763-5da0-a9b4-080ca5536b55,auto-approved,0.85,
2fa199d1-e87f-5b65-aab4-09a92436cd84,auto-approved,0.82,
30a19b64-6e0f-503e-a7b4-04d2a31a2fb3,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note|validator-note
31a19cf7-ef2b-5e03-a8b4-066f21fd91e2,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note
32a19e8a-6bd5-54b4-a5b4-0198a0e0f411,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note|validator-note
3637814e-2f79-59e4-b7af-97780742ae11,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note|validator-note|validator-note
393e41cc-d7fc-5bd4-b6a2-c9489deb55c5,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note|validator-note|validator-note
45cf3f8b-a109-569f-be59-5a3370ed2d2e,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note|validator-note
46796af0-c703-5de2-bda0-f26edadfbbff,flagged,0.62,low-quality-flag|validator-note|validator-note|validator-note
48796e16-c4c9-5258-bba0-ef34d8a6805d,flagged,0.55,low-quality-flag|ambiguous|validator-note|validator-note
49128883-7b95-5ab9-b0dc-1395dab15b5c,flagged,0.55,low-quality-flag|grammar-point-mismatch|validator-note|validator-note|validator-note
49796fa9-45e6-501d-bca0-f0d15789e28c,flagged,0.62,low-quality-flag|ambiguous|validator-note
4a79713c-cb75-54f6-b9a0-ebfad66d44bb,auto-approved,0.82,
4acf476a-2226-5464-b759-4ee8eb5e1819,flagged,0.55,low-quality-flag|ambiguous|validator-note|validator-note|validator-note
4b128ba9-7dce-5643-b2dc-16cfdcea96fe,flagged,0.62,low-quality-flag|ambiguous|grammar-point-mismatch|validator-note|validator-note|validator-note|validator-note
4b7972cf-4c92-52bb-baa0-ed975550a6ea,auto-approved,0.85,
4bdd49fe-21cf-5a3a-acf6-63d603248be3,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note|validator-note|validator-note|validator-note
4c128d3c-f605-55e0-b3dc-186c575b81e9,auto-approved,0.82,
4c797462-c93c-596c-b7a0-e8c0d4340919,auto-approved,0.88,
4d7975f5-4a58-5731-b8a0-ea5d53176b48,auto-approved,0.82,
4ddd4d24-2409-55c4-a6f6-5a28055dc785,flagged,0.62,low-quality-flag|grammar-point-mismatch|validator-note|validator-note|validator-note|validator-note
6d41a52a-f3c0-5aae-b373-8a4288129387,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note|validator-note
6e46d1d0-f8b6-5d0c-a921-5d00287ae425,flagged,0.5,low-quality-flag|ambiguous|grammar-point-mismatch|validator-note|validator-note|validator-note|validator-note
6f46d363-79d3-5ad1-aa21-5e9da75e4654,flagged,0.62,low-quality-flag|grammar-point-mismatch|validator-note|validator-note|validator-note
7146d689-7c0c-565b-ac21-61d7a99781f6,auto-approved,0.82,
7246d81c-f444-55f8-ad21-637424086ce1,flagged,0.5,low-quality-flag|grammar-point-mismatch|validator-note|validator-note|validator-note
736f2544-04ab-5968-b468-dd74bda9df41,auto-approved,0.82,
746f26d7-85c8-572d-b568-df113c8d4170,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note|validator-note
7546dcd5-7799-5f47-b021-684ba5250ab2,auto-approved,0.82,
766f29fd-8801-52b7-b768-e24b3ec67d12,flagged,0.72,ambiguous|validator-note|validator-note
83dce776-351f-5c20-954d-099c160716f5,flagged,0.55,low-quality-flag|validator-note|validator-note|validator-note|validator-note
857c0529-5587-5037-ab73-bb1b5069181a,flagged,0.62,low-quality-flag|validator-note|validator-note|validator-note|validator-note
897c0b75-59f9-574b-a773-b4a754db8f5e,flagged,0.5,low-quality-flag|grammar-point-mismatch|validator-note|validator-note|validator-note|validator-note
8b45af80-504e-56b4-a421-00a869d5444d,flagged,0.55,low-quality-flag|ambiguous|grammar-point-mismatch|validator-note|validator-note|validator-note|validator-note
8c45b113-d16b-5479-a521-0245e8b8a67c,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note
8d45b2a6-5288-523e-a621-03e26c0e7fef,flagged,0.62,low-quality-flag|grammar-point-mismatch|validator-note|validator-note|validator-note
8e45b439-d3a4-5003-a721-057feaf1e21e,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note|validator-note
9045b75f-ccf9-5d65-a921-08b9e4462f38,auto-approved,0.85,
9145b8f2-4e15-5b2a-aa21-0a56679c08ab,auto-approved,0.88,
9245ba85-cf32-58ef-ab21-0bf3e67f6ada,flagged,0.52,low-quality-flag|grammar-point-mismatch|validator-note|validator-note|validator-note
9345bc18-5933-54dc-9c20-f3c060f055c5,flagged,0.72,ambiguous|validator-note
97414536-2410-5bbe-a026-42222bcceac7,auto-approved,0.88,
984146c9-a52d-5983-a126-43bfaab04cf6,flagged,0.62,low-quality-flag|grammar-point-mismatch|validator-note|validator-note|validator-note
9d414ea8-2abc-5e5c-9626-320032789dad,flagged,0.62,low-quality-flag|ambiguous|validator-note
9e41503b-abd8-5c21-9726-339db15bffdc,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note
9f4151ce-2cf5-59e6-9826-353a34b1d94f,auto-approved,0.88,
a0415361-ae11-57ab-9926-36d7b3953b7e,auto-approved,0.85,
a14154f4-2649-5748-9a26-38742e062669,auto-approved,0.82,
a2415687-a766-550d-9b26-3a11ace98898,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note
a341581a-2882-52d2-9c26-3bae303f620b,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note|validator-note
a44159ad-a99f-5097-9d26-3d4baf22c43a,flagged,0.55,low-quality-flag|ambiguous|validator-note|validator-note
b045b8e6-17b2-5e6c-b5aa-4c5086af79b9,flagged,0.62,low-quality-flag|validator-note|validator-note|validator-note|validator-note|validator-note
c75a884c-bb28-5380-a8aa-880c5d7bec69,auto-approved,0.82,
c95a8b72-bd61-5f0a-aaaa-8b465fb5280b,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note
ca5a8d05-3e7e-5ccf-abaa-8ce3de988a3a,auto-approved,0.85,
e832ee14-df69-5394-bbdd-2a5830b40205,auto-approved,0.82,
eb32f2cd-62bf-5ce3-bedd-2f2fb1d09fd6,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note
f43f85cc-466d-5888-8567-c784232058e1,flagged,0.55,low-quality-flag|ambiguous|validator-note|validator-note|validator-note
f53f875f-c78a-564d-8667-c921a203bb10,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note|validator-note
f83f8c18-41fb-5174-8967-cdf83077bead,flagged,0.55,low-quality-flag|ambiguous|validator-note
f93f8dab-c317-5f39-8a67-cf95af5b20dc,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note|validator-note
fa3f8f3e-4434-5cfe-8b67-d13232b0fa4f,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note|validator-note
fb3f90d1-c550-5ac3-8c67-d2cfb1945c7e,auto-approved,0.85,
fc3f9264-3d88-5a60-8d67-d46c2c054769,flagged,0.62,low-quality-flag|ambiguous|validator-note|validator-note
fd3f93f7-bea5-5825-8e67-d609aae8a998,flagged,0.55,low-quality-flag|validator-note|validator-note|validator-note
fe3f958a-3fc1-55ea-8f67-d7a62e3e830b,auto-approved,0.88,
ff3f971d-c0de-53af-9067-d943ad21e53a,auto-approved,0.88,

```
