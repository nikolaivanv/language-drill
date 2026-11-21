-- TR 3pl predicate agreement repair, applied to prod (br-green-waterfall-ancrvpr5)
-- on 2026-11-21 via the Neon MCP. Recorded here; not run by any migration.
--
-- Idempotent: the `?` guard skips a row that already lists the value, and the
-- review_status / language guards keep a stale id from reaching another row.
-- Rollback material: ./before.json (prior acceptableAnswers + content_json md5).

-- 1. 56 approved rows (35 cloze + 21 translation) gain the counterpart form.
WITH plan(id, ans) AS (VALUES
 ('9d6c64b6-bade-553c-b643-2c8086583ff1'::uuid,'ödemedi'),
 ('da67253f-9d27-5987-8388-9a3b6e5c7726','geldi'),
 ('36e8ac0b-f0d2-5e53-acc1-94afaa176f4a','yemedi'),
 ('5943ab40-9d7e-5ef0-bdc2-f6ecc9812601','gelmedi'),
 ('d1b8c54f-a071-5361-8076-7e0dee55bb5c','uyumadı'),
 ('5fca6168-d1f4-55a4-8323-56d86a52e3ed','şaşırmayacak'),
 ('a8c8a015-fd22-5479-ba52-8015405ae828','korkmayacak'),
 ('65ca6ada-cfbb-5a1a-8923-60866819a84b','gelmeyecek'),
 ('d7c2cf8b-399b-5c9f-8725-9a031dce81c6','almayacak'),
 ('d1c2c619-4047-5f3d-bd25-89e1247a34ac','konuşmayacak'),
 ('4e930a2c-c1cf-5a16-afb1-58da0700c863','yemiyor'),
 ('f8376802-c3d9-558e-8f89-8be2075cbc47','yemiyor'),
 ('2e1c73ad-3907-57b3-b547-a85f54c97976','dinlemiyor'),
 ('26bae126-9de9-56dc-8e9f-e120eca0d4f9','kalmıyor'),
 ('43e0e56d-bbcd-59fd-9d9e-05a1e3a2d8bc','yemez'),
 ('0fe42aed-c362-5f95-a0b5-3f39b3455904','yorgunmuş'),
 ('53eb1e21-84c4-53ad-b662-2961e00a386c','yaramazdı'),
 ('7f39a8c1-bcff-515f-952a-5753c251c812','gelseydi'),
 ('4eed0193-5bd4-5c71-88e3-d32d23921114','dinliyordu'),
 ('287f09a2-4cbe-5f02-aa3d-f48e46a82543','yapıyordu'),
 ('f5e2dd1c-b186-5ad8-b733-6db46a359e21','uyumuyordu'),
 ('9fe48578-bc31-5294-99ed-fce8a523854d','hesaplamıyordu'),
 ('a5e48eea-b9f8-570a-9fee-0696a2ea49ab','çizmiyordu'),
 ('f6e2deaf-32a3-589d-b833-6f51e9190050','konuşmuyordu'),
 ('00868c49-de3c-5f7b-827f-d4d7fb74a3b6','konuşmuyordu'),
 ('e10aa1b8-3715-5628-9cbd-1a54fc8fb9a1','çalışmıyordu'),
 ('17528728-ea7a-53a8-94b0-bbd438ed12f1','doğrulamalıymış'),
 ('90804b0d-771c-5d69-8e24-20f5cc70e120','olacaktı'),
 ('429fe69f-c9a0-5aef-b246-391360e1ef6e','okurdu'),
 ('eb0bdd8a-f089-5172-93a7-a13ec61071e3','yardımsever değildi'),
 ('e80bd8d1-7619-564b-90a7-9c6749664b56','tartışmamıştı'),
 ('36aaf8b2-8c78-530c-a86c-6b5051d22a11','tahrip etmemişti'),
 ('c4a53073-12c7-5be7-a040-d41b983e960e','hazırlanmak zorunda değildi'),
 ('31aaf0d3-0b5b-5547-af6c-769bd7613f26','giderdi'),
 ('bfae0ef4-5a8d-5d54-bd6e-c9e891888fe5','yaşardı'),
 ('91a72fe9-9ddb-5fe1-969d-ca1d9bed31e0','Onlar arkadaş değil.'),
 ('a979270f-57c2-53fd-8af0-e3c193a7dac8','Onlar dün arkadaşlarını aramadı.'),
 ('e1156e25-87d1-54db-9e22-f667d542cec6','Onlar dün çok güldü.'),
 ('48992863-30ba-548d-adc4-537134d978e0','Onlar bütün suyu içti.'),
 ('400e1134-50aa-5bcc-a51a-00705bd8f8d5','Onlar hesabı ödemedi.'),
 ('8268166d-31a1-5a2f-9a4e-37b3a3e964a2','Onlar hediye almayacak.'),
 ('65a3b149-90cd-5365-bf43-73a98136604c','Onlar odayı temizlemiyor.'),
 ('b8a4d7ae-8c9a-5b7c-b34a-11504e0582a9','Onlar mühendis.'),
 ('b4a70ff9-f8b4-598b-b34d-1c8705f397c6','Onlar meşgul.'),
 ('35aa19a3-d893-5023-b84f-614f2614625a','Onlar öğretmen.'),
 ('ae32289b-bae3-506f-872f-4e53058f5656','Onlar şimdi televizyon izlemiyor.'),
 ('23b4fe7c-72af-5ec0-9ec8-34ccaab47ca1','Onlar her gün su içerler.'),
 ('e47d92b3-4ce5-5f4f-8bf3-64538610c5f6','Onlar yolculuktan sonra çok yorgunmuş.'),
 ('fe50c5dd-a5a9-59f5-b6e1-0479cff4361c','Onlar çocuklara iki litre su içirmedi.'),
 ('dde9d3c6-b3b1-50de-9e9d-2a22d1cd09ff','Onlar çocukları inandırmadı.'),
 ('f04c32a5-8489-58b1-9cd1-d13de348ca38','Onlar çocuklara haritayı çizdirmedi.'),
 ('a599dccd-3e66-5687-b337-d79b75dec5aa','Onlar Tokat''ta oturmuyordu; Ankara''da oturuyordu.'),
 ('8944ddd5-fd50-5211-b106-c93d7a1f5330','Onlar öğretmeni dinlemiyordu.'),
 ('2935905d-3030-5305-a567-2299e07250fc','Onlar toplantıya gelmezse, kararı onlarsız vereceğiz.'),
 ('2746d658-4fb7-5448-936e-8a34416e2439','Onlar zamanında gelmezse, toplantıya onlarsız başlayacağız.'),
 ('6f1443e8-08f2-5764-840c-fb68a028328d','Onlar törende meşale kullanmayacakmış.')
)
UPDATE exercises e
SET content_json = jsonb_set(
      e.content_json, '{acceptableAnswers}',
      COALESCE(e.content_json->'acceptableAnswers', '[]'::jsonb) || to_jsonb(p.ans), true)
FROM plan p
WHERE e.id = p.id
  AND e.language = 'TR'
  AND e.review_status IN ('auto-approved','manual-approved')
  AND NOT (COALESCE(e.content_json->'acceptableAnswers','[]'::jsonb) ? p.ans);
-- → 56 rows.

-- 2a. The reported attempt: "Onlar odayı temizlemiyor." 0.8 → 1.0.
--     (score is `real`, so 0.8 is not exactly representable — guard by range.)
UPDATE user_exercise_history
SET score = 1,
    response_json = $j${"evaluation": {"score": 1, "errors": [], "feedback": "Correct. \"temizlemiyor\" raises and harmonizes the negative suffix before -yor, and \"odayı\" is correctly marked accusative for the definite object. With the explicit subject \"Onlar\", the plural ending -lar on the verb is optional: \"Onlar odayı temizlemiyor.\" and \"Onlar odayı temizlemiyorlar.\" are both correct standard Turkish. (Re-scored 2026-11-21: originally 0.8 for a plural-agreement error that was not an error.)", "correctedAnswer": "Onlar odayı temizlemiyor.", "grammarAccuracy": 1, "taskAchievement": 1, "vocabularyRange": "A1", "evaluationSource": "llm", "estimatedCefrEvidence": "A1"}, "userAnswer": "Onlar odayı temizlemiyor."}$j$::jsonb
WHERE id = 'a339a209-93a4-416b-864c-78df9b13e193' AND score > 0.79 AND score < 0.81;

DELETE FROM error_observations
WHERE id = '8f5e1d62-bfc5-41c5-9325-eed102315791'
  AND exercise_history_id = 'a339a209-93a4-416b-864c-78df9b13e193'
  AND error_grammar_point_key = 'tr-a1-personal-suffixes'
  AND wrong_text = 'temizlemiyor';

-- 2b. The older instance of the same defect (2026-06-17): 0.85 major → 1.0.
UPDATE user_exercise_history
SET score = 1,
    response_json = $j${"evaluation": {"score": 1, "errors": [], "feedback": "Correct. The future suffix -(y)AcAk is formed correctly and the word order is natural. With the explicit subject \"Onlar\", the plural ending -ler on the verb is optional: \"Onlar partide çok gülecek.\" and \"Onlar partide çok gülecekler.\" are both correct standard Turkish. (Re-scored 2026-11-21: originally 0.85 for a plural-agreement error that was not an error.)", "correctedAnswer": "Onlar partide çok gülecek.", "grammarAccuracy": 1, "taskAchievement": 1, "vocabularyRange": "A1", "estimatedCefrEvidence": "A1"}, "userAnswer": "Onlar partide çok gülecek."}$j$::jsonb
WHERE id = 'a2de6f2b-8029-4660-9896-4ab180057f4b' AND score > 0.84 AND score < 0.86;

DELETE FROM error_observations
WHERE id = '8b922093-ae3b-4532-ac04-8fad99d2ae5b'
  AND wrong_text = 'gülecek' AND correction = 'gülecekler';
