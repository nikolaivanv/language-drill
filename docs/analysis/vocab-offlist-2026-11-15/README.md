# Off-list vocab_recall cleanup — 2026-11-15 (prod)

vocab_recall exercises in curated topics whose `expectedWord` was not on the topic's approved `vocab_target` list
(632 rows / 406 topic×word pairs). Origin: unseeded free-generation slots between 2026-07-12 and 2026-10-21 (fixed by #797),
plus pre-curation legacy rows. None created after #797.

## Applied (prod branch br-green-waterfall-ancrvpr5)

| Action | Pairs | Rows |
|---|---|---|
| add | 262 | 405 |
| reapprove | 2 | 5 |
| demote | 32 | 45 |
| demote-quality | 2 | 2 |
| leave | 108 | 175 |

- **add** — 262 new `vocab_target` rows, `status='approved'`, `source='edited'`, created 2026-11-15 (exact rows in `plan.json` → `inserts`).
- **reapprove** — `Mittag` (de-a1-vocab-time-calendar), `kilo vermek` (tr-b1-vocab-health-lifestyle): rejected for their topic but approved nowhere.
- **demote** — 45 exercises → `review_status='rejected'`, `demotion_reason='pool-hygiene'` (curator-rejected word for that topic, off-topic, compositional, near-duplicate).
- **demote (quality)** — 5 exercises with wrong prompts (esposa ×2, esposo, cambio, Generation); 0 learner attempts, so no mastery impact. esposa/esposo stay as targets → regenerated once generation resumes.
- **leave** — word already approved in another topic (themed↔group overlap is allowed since #794), or a dedup loser whose home got the target.

After: 0 off-list rows that aren't on another topic's list; 173 overlap rows remain by design.

## Rollback

```sql
-- 1. remove added targets
delete from vocab_target where source='edited' and created_at::date='2026-11-15';
-- 2. undo re-approvals
update vocab_target set status='rejected' where id in ('d4411111-4302-46e2-9c21-3d7ffbd25315','9c6aa963-c96b-45a4-92f0-5155d976caa7');
-- 3. restore demoted exercises (all were approved with demotion_reason NULL; prior status per id in plan.json → demotes)
update exercises set review_status='auto-approved', demotion_reason=null where id in ('78764390-3e8e-5854-b094-18b823d9c7cd','8df818d7-d1c7-5005-9065-84e94180a488','6e5a6d19-4691-58cb-b4c6-16479684c266','979bc671-7d60-56e3-9ab1-ea6f55e0e8ee','0f160e9b-9784-5cb1-b492-8d1db2737044','0f60b2ac-2f65-5270-81c4-297c5c5ae559','0da8f631-b758-50cb-9361-7027715ed246','907ea870-66d3-5c9c-a5f2-0030cb491015','c763bace-3956-5f04-ab88-014804aab999','943d3de9-c65e-5c19-b1d9-e9d59886d518','569e7c72-042b-57f0-9170-c4dc609633ad','8ceea41f-1b8a-5d0f-a886-65037356f50e','b930e3c0-e9de-565e-8cb8-5172c86a087b','fc188782-7039-58b0-b230-491c0d238d9d','80b81987-975f-58f7-a822-a3bb083f68a6','d91f2a16-1c5e-59a4-90c4-a33891c7b0f9','d137f2eb-be48-58a9-8133-0305a9a60ea4','f2bbf982-17b8-5678-80ce-d914fc10338d','2b963af7-051a-50b1-8604-72bdf3b03314','cf6bf6d4-c402-5478-ac89-9e44d7dd96a1','6f15a958-f1ff-5bd0-8028-746c229c0a01','58a11b38-8ee7-5e70-b03d-3f4c8a80e861','154b5067-6b2e-54cf-889d-7d43fdda561e','4e7b9e6c-f267-5290-a452-de2ccf803d09','27581b20-ae11-5d04-be61-e648568bede5','069fd2a9-7628-5027-b527-b26b129a7612','66318b5b-5310-5d05-a603-f4d9f239bb58','cd775e96-f6d1-5626-b121-39da45117a8f','f6c763a5-6b31-5e51-9e93-703dacc34cb0','88439e62-3a80-5e3c-8ff2-14d0c79d8d81','ed23b60b-8469-515f-b751-c713807fb79e','c469cc4c-d2b1-5c7e-95ba-e8d2baa994ab','d176a777-9c5f-59a7-bbed-e14b860527e6','63bbb12d-8ad5-53bb-a18e-ece738ce9556','d61fdbe5-49ec-5903-a411-973f8433cd5e','493acac1-1337-54e7-aed0-3a4bb6ec573a','9bf2de89-cc4c-56a1-843e-530d915b8f20','b8158dcd-ea4b-5519-847b-50753ecc1920','25618835-bfa2-5b2b-a1c7-bcf700a12d46','3369d922-aa90-581e-b16e-72a2df4e101f','3d17b931-8c2b-5639-942d-0205a37d1a90','dd33e1c6-21c4-50ec-887d-887061030929','9bea147a-252a-5e1c-8c8a-a73080b847e9','5ea71256-38c8-58ce-a5f1-b9f24eb2a77f','1922d6ab-1612-5f5f-b82a-74c35fda5cbe','8a2104ee-b8c1-53a0-89ac-e7fc4704bced','a5c06340-9cef-5d42-be61-47cee14056cf','a6c064d3-1e0c-5b07-bf61-496b6023b8fe','abc06cb2-9f28-58cc-b861-3e20da94a3e9','a8c067f9-1bd2-5f7d-bd61-46315dea7d5c');
```

## Files
- `rows.before.json` — snapshot of all 632 off-list rows before any write
- `pairs.json`, `topics.json` — grouped worklist + topic descriptions
- `glosses.py`, `build_plan.py` → `plan.json` — every per-pair decision with reason, inserts, demotes
- `apply-*.sql` — the statements run


## Part 2 — orphaned `tr-a1-everyday-vocab` / `tr-a2-everyday-vocab` (same day)

Both points were removed from the curriculum on 2026-06-07 (3659888f, the TR vocab split into themed umbrellas), but their 37 approved
vocab_recall rows kept the dead key and stayed **servable**: `sampleFreshPool` (daily plan) and targeted top-ups filter only on
language/level/type/status, never on curriculum membership. Snapshot: `tr-everyday-vocab-orphans.before.json`.

- **demote** 32 rows (`pool-hygiene`): 30 words already approved and exercised in a themed topic, plus a duplicate kahvaltı and iskemle (dated synonym of sandalye).
- **rehome** 5 rows (word existed nowhere else) + 5 new targets: Salı / öğle yemeği / akşam yemeği → `tr-a2-vocab-time-daily-routine` (A2);
  limon → `tr-a1-vocab-food-drink`, süpürge → `tr-a1-vocab-home-objects` (difficulty A2 → A1).
- **reject** 20 flagged orphan rows still in the review queue (approving one would have resurrected an orphan).

Rollback:
```sql
update exercises set review_status='auto-approved', demotion_reason=null where id in ('879bb7ce-2c70-5e36-9664-24fa001303a7','b4923866-dc68-50d2-8246-03fe8ffbbd2b','a361b744-56a9-5896-aacb-a4ba1fec12db','d7409820-ebed-5e04-a122-e1288439444d','c19f35f5-4d2a-5203-8306-39ff0458b99e','41e8ceba-5222-58f2-8b61-29fe8ff4720b','12936415-8296-5655-a810-7df97a96344c','11936282-0179-5890-a710-7c5cfbb2d21d','1a97eddb-63af-509b-9815-ac17cf4f3a8a','3f369a8d-a985-5b53-90a7-93cf6a9b169e','1495a5d2-f55b-5702-9e13-790e34bd850b','80ed6830-40f0-594a-a993-67160a945437','2ee433a3-ff7d-51ad-905b-ea213b1650b0','1ea2fff0-c1b2-50c2-ae00-db5ec63c2d9f','8ced7b14-4e47-5e86-9d93-53ba0f06cb7b','74e4471b-655b-5db7-ab7a-81fbbcb53bae','aeebb8e8-3674-569e-8c64-36d2a2bdd6d3','be9f313c-c9d4-58b4-8006-3528833c1bcd','5a7fe4b9-1b6c-5adb-9506-9197c95e3bbe','c39f391b-4f63-5d8d-bd06-3051f4c81830','3936911b-a2d9-58b5-92a7-970963ef63b8','3c3695d4-262f-5204-8da7-8ef8e97e78cd','3b369441-a512-543f-94a7-9a4366289f5a','3a3692ae-23f6-567a-93a7-98a6e7453d2b','2de43210-7e61-53e8-8f5b-e884bc32ee81','1195a119-7aea-5bdb-9b13-7437b8135e7e','4114e609-06f2-58a7-8097-aa5b0561b5fa','3d369767-a74b-5fc9-8ea7-90956861dafc','6db69ecd-f49e-53f3-baa7-d6ef5cd76c3e','38368f88-21bc-5af0-91a7-956ce50c0189','3e3698fa-2868-5d8e-8fa7-9232ebb7b46f','40e8cd27-d105-5b2d-8a61-28610c9e9898');
update exercises set review_status='flagged', demotion_reason=null where id in ('22ded6b8-9ebe-54e0-99a6-604c8f0712e1','1fa30183-42ce-5e87-af00-dcfb451f8fce','20a30316-bf79-5538-ac00-d824c402f1fd','23a307cf-4741-559b-ab00-d68740ad188a','24a30962-c3eb-5c4c-a800-d1b0bf907ab9','707cb052-d6d0-53ec-8aef-7360ea379139','829bafef-9dfc-5b35-a164-36b9812fa178','3f14e2e3-04b8-5d1d-be97-a72103287a58','c60f3ca3-abb8-50bd-b3a4-a89141719bb8','4014e476-85d5-5ae2-bf97-a8be867e53cb','4214e79c-880e-566c-b997-9f1088b78f6d','54663aa1-e582-590d-8e37-cb2189055b0c','3e14e150-839c-5f58-bd97-a58484451829','88ed74c8-49d5-5772-a193-5a2e137942bf','1a764948-534e-5e8e-929f-9a829eab773b','31368483-abbe-56dd-8aa7-8a215b0a7530','4414eac2-8a47-51f6-bb97-a24a8af0cb0f','52473af0-2c32-5e84-9c66-fb28b1542485','6ab69a14-7148-5aa4-b7a7-d218dbbace6d','b47c49da-4033-52c0-bcc5-a0ec478f2f9d');
update exercises set grammar_point_key='tr-a1-everyday-vocab', difficulty='A1' where id='839bb182-1f18-58fa-a264-385604857aeb';
update exercises set grammar_point_key='tr-a2-everyday-vocab', difficulty='A2' where id in ('0e959c60-f795-528c-9813-6f6036f6c0ad','acebb5c2-38ad-5228-8664-2d24addc00fd','bd9f2fa9-48b8-5aef-8706-4073ffe6425a','bf9f32cf-4af1-5679-8106-36c5021f7dfc');
-- the 5 new targets are covered by part 1's `delete ... where source='edited' and created_at::date='2026-11-15'`
```
