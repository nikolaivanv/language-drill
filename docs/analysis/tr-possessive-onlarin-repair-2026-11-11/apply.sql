-- TR onların + -(s)I repair, prod 2026-11-11. Record + rollback: README.md

-- 1. Exercises: accept the 3sg -(s)I form after an overt onların (G&K §14.4 ex. 112-114).
UPDATE exercises SET content_json = content_json || '{"acceptableAnswers":["kapısı"]}'::jsonb
WHERE id = '48d31672-7748-5788-a813-cae45a9adf65' AND review_status = 'auto-approved' AND content_json->>'correctAnswer' = 'kapıları' AND NOT content_json ? 'acceptableAnswers'
RETURNING id, content_json->'acceptableAnswers';
UPDATE exercises SET content_json = content_json || '{"acceptableAnswers":["arabası"]}'::jsonb
WHERE id = 'e84c0d0c-12fb-5b36-b9ee-34ca337a39c3' AND review_status = 'auto-approved' AND content_json->>'correctAnswer' = 'arabaları' AND NOT content_json ? 'acceptableAnswers'
RETURNING id, content_json->'acceptableAnswers';
UPDATE exercises SET content_json = content_json || '{"acceptableAnswers":["odası"]}'::jsonb
WHERE id = '4ed31fe4-709c-54ea-b213-db0665b9098f' AND review_status = 'auto-approved' AND content_json->>'correctAnswer' = 'odaları' AND NOT content_json ? 'acceptableAnswers'
RETURNING id, content_json->'acceptableAnswers';
UPDATE exercises SET content_json = content_json || '{"acceptableAnswers":["odası"]}'::jsonb
WHERE id = 'fc49edf1-2f43-55af-8df5-d9b396af48a2' AND review_status = 'auto-approved' AND content_json->>'correctAnswer' = 'odaları' AND NOT content_json ? 'acceptableAnswers'
RETURNING id, content_json->'acceptableAnswers';
UPDATE exercises SET content_json = content_json || '{"acceptableAnswers":["odası"]}'::jsonb
WHERE id = '744f2807-71be-5409-bdf1-4675d92a196c' AND review_status = 'auto-approved' AND content_json->>'correctAnswer' = 'odaları' AND NOT content_json ? 'acceptableAnswers'
RETURNING id, content_json->'acceptableAnswers';
UPDATE exercises SET content_json = content_json || '{"acceptableAnswers":["fotoğrafı"]}'::jsonb
WHERE id = '6e4f1e95-7cdc-5dbb-b7f1-3cc7d27e6686' AND review_status = 'auto-approved' AND content_json->>'correctAnswer' = 'fotoğrafları' AND NOT content_json ? 'acceptableAnswers'
RETURNING id, content_json->'acceptableAnswers';
UPDATE exercises SET content_json = content_json || '{"acceptableAnswers":["kedisi"]}'::jsonb
WHERE id = 'b5a3215a-9d6a-5d44-b614-d6b8f6264601' AND review_status = 'auto-approved' AND content_json->>'correctAnswer' = 'kedileri' AND NOT content_json ? 'acceptableAnswers'
RETURNING id, content_json->'acceptableAnswers';
UPDATE exercises SET content_json = content_json || '{"acceptableAnswers":["noktası"]}'::jsonb
WHERE id = 'e64c09e6-0c4f-5898-bbee-380435b37565' AND review_status = 'flagged' AND content_json->>'correctAnswer' = 'noktaları' AND NOT content_json ? 'acceptableAnswers'
RETURNING id, content_json->'acceptableAnswers';

-- 2. The learner's 0.2 attempt on kapısı → 1.0 (the nightly mastery rebuild replays this score).
UPDATE user_exercise_history SET score = 1,
  response_json = jsonb_set(response_json, '{evaluation}'::text[], ((response_json->'evaluation') - 'correctedAnswer'::text) || '{"score":1,"grammarAccuracy":1,"taskAchievement":1,"errors":[],"feedback":"Correct. After the plural possessor \"onların\", one possessed thing usually takes the 3rd person singular suffix -(s)I: \"onların kapısı\" (their door). \"Onların kapıları\" is also correct but usually means \"their doors\". (Corrected 2026-11-11: this answer was first marked wrong at 0.2 by an evaluator error.)"}'::jsonb)
WHERE id = 'efd62fb2-e723-4c60-a390-6ac3c4a8e397' AND score < 0.25
RETURNING id, score;
DELETE FROM error_observations WHERE id = '2a1c94e3-fec1-43fe-ac18-d2756b28fd2f' AND wrong_text = 'kapısı' RETURNING id;

-- 3. Theory page: see theory-after.json; applied with an md5 guard on the before page.
-- UPDATE theory_topics SET content_json = <theory-after.json>::jsonb, quality_score = 0.85, updated_at = now()
-- WHERE id = '127e02e5-a684-5cc3-b89f-da5fc1f79396' AND md5(content_json::text) = '36848ca7a760aafe6c3995a3d7cc6fc8'
-- RETURNING md5(content_json::text);  -- expect 08188320696288a3733f987be4dea58a
