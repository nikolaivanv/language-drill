# ES school vocab_recall — escuela / colegio / universidad repair (2026-11-09)

Learner-reported. Card `403d826c` (`es-a2-vocab-work-school`, `la escuela`) read
"The place where students go to learn, attend classes, and study subjects like
math and science." — equally true of `la universidad` and `el colegio`, and no
alternate was accepted. The learner answered `la universidad` and was marked wrong.

## Sweep

Every approved ES `vocab_recall` row whose `expectedWord` is a school word
(escuela / colegio / universidad / instituto / facultad / academia / guardería).
All defective rows predate #661 (2026-08-17, the distinct-referents rule), and
generation is paused, so this is a data repair; the prompts already carry the rules.

- **escuela ↔ colegio are treated as same-referent synonyms** at A1/A2. Which
  word is used depends on the country (Spain: `colegio` is the everyday primary/secondary school;
  much of Latin America: `escuela` primary, `colegio` secondary/private), so no
  level-appropriate definition can separate them honestly. Per the generation
  prompt's own fallback, each now lists the other in `acceptableAnswers`.
- **universidad is a distinct referent.** Every definition now names children /
  teenagers (and, where it was generic, says "not a university").
- Gender/article hints ("It is a feminine noun", "the article 'el'") were
  replaced wherever the card now accepts the other-gender synonym — that hint
  contradicts the alternate (the validator flagged the same contradiction on
  `f8c95327`).
- `12d57e68` hint 3 gave the answer away by etymology ("shares a root with
  'college'"), which the anti-leak rule forbids; it was replaced.
- B1 `universidad` / `instituto` / `facultad` rows are already well separated —
  untouched. `d9da0320` (A1) was already correct — untouched.

## Edits (`review_status` unchanged)

| id | cell | change |
|---|---|---|
| `403d826c-bf22-51b2-9125-990ea7126337` | A2 work-school, la escuela | prompt → children/teenagers, not a university; `+acceptableAnswers ["el colegio"]` |
| `be7d0476-e36e-5372-9908-66aedadabba3` | A2 work-school, escuela | prompt → children, read/write/count, not a university; hint 1 (gender) replaced; `+acceptableAnswers ["el colegio"]` |
| `12d57e68-5a8e-503a-8901-f4e6e4f8e05f` | A2 work-school, colegio | hint 1 (gender) + hint 3 (etymology leak) replaced; `+acceptableAnswers ["la escuela"]` |
| `1df66e80-7350-553a-8285-b0f68b78b8b7` | A2 work-school, el colegio | prompt → niños y adolescentes, no es la universidad; `+acceptableAnswers ["la escuela"]` |
| `bb92bd43-f599-5c5d-82bb-59b19396bc68` | A1 city-places, escuela | hint 3 ("la _____") replaced; `+acceptableAnswers ["el colegio"]` |
| `7206209b-5149-5655-b599-35694eb46368` | A1 city-places, la escuela | prompt "students" → children; hint 3 (gender) replaced |
| `e4034c73-e1d7-5207-bdd3-cf6bfd1ea73e` | A1 city-places, la escuela | prompt "children and adults" → children (adults admitted academia/universidad) |
| `56415272-53a5-5e8c-a30d-f84072653061` | A1 city-places, el colegio | hint 3 (gender) replaced |

`_dedupKey` was updated alongside every changed prompt.

## Demotions (`review_status = 'rejected'`, `demotion_reason = 'duplicate'`)

Four `escuela` cards in one A2 cell was redundant; the two with
spelling/etymology hints went. `duplicate` leaves learner scores untouched.

| id | why |
|---|---|
| `24f67985-f6a6-5e89-bd85-a8e503b06800` | hints "beginning with a vowel sound", "three syllables" (anti-leak); generic prompt |
| `23f677f2-7589-50c4-bc85-a74884cd05d1` | hints "nouns ending in -a", "closely related to the English word"; generic prompt |

Both were `auto-approved`, `demotion_reason` NULL.

## Forward SQL (as applied)

See `es-school-vocab-repair-2026-11-09.sql`.

## Rollback

```sql
UPDATE exercises SET content_json = (content_json - 'acceptableAnswers') || '{"prompt":"The place where students go to learn, attend classes, and study subjects like math and science.","_dedupKey":"la escuela::the place where students go to learn, attend classes, and study subjects like math and science."}'::jsonb
WHERE id = '403d826c-bf22-51b2-9125-990ea7126337';

UPDATE exercises SET content_json = (content_json - 'acceptableAnswers') || '{"prompt":"The place where students go to learn, with classrooms and teachers.","_dedupKey":"escuela::the place where students go to learn, with classrooms and teachers.","hints":["It is a feminine noun.","Think of a building full of children and lessons.","It refers to a primary or elementary learning institution."]}'::jsonb
WHERE id = 'be7d0476-e36e-5372-9908-66aedadabba3';

UPDATE exercises SET content_json = (content_json - 'acceptableAnswers') || '{"hints":["It is a noun, and it is masculine.","Think of a building full of classrooms, teachers, and students aged roughly 6–16.","It shares a root with the English word ''college'', but refers to a primary or secondary school in Spanish."]}'::jsonb
WHERE id = '12d57e68-5a8e-503a-8901-f4e6e4f8e05f';

UPDATE exercises SET content_json = (content_json - 'acceptableAnswers') || '{"prompt":"El lugar donde los estudiantes van a aprender, con aulas, profesores y recreo.","_dedupKey":"el colegio::el lugar donde los estudiantes van a aprender, con aulas, profesores y recreo."}'::jsonb
WHERE id = '1df66e80-7350-553a-8285-b0f68b78b8b7';

UPDATE exercises SET content_json = (content_json - 'acceptableAnswers') || '{"hints":["Think of a place in your neighborhood where young students carry backpacks and books.","It is a public building — you can find it on most city maps alongside the park and the library.","The word is a feminine noun: ''la _____''."]}'::jsonb
WHERE id = 'bb92bd43-f599-5c5d-82bb-59b19396bc68';

UPDATE exercises SET content_json = content_json || '{"prompt":"A place where students go to learn, with teachers and classrooms.","_dedupKey":"la escuela::a place where students go to learn, with teachers and classrooms.","hints":["It is a building in the city where children study every day.","Think of a place with teachers, students, and classrooms.","It is a feminine noun — remember to use the correct article."]}'::jsonb
WHERE id = '7206209b-5149-5655-b599-35694eb46368';

UPDATE exercises SET content_json = content_json || '{"prompt":"A place where children and adults go to learn. There are teachers and classrooms inside.","_dedupKey":"la escuela::a place where children and adults go to learn. there are teachers and classrooms inside."}'::jsonb
WHERE id = 'e4034c73-e1d7-5207-bdd3-cf6bfd1ea73e';

UPDATE exercises SET content_json = content_json || '{"hints":["It is a place in the city where children go every weekday morning.","Think of a building with classrooms, a playground, and a teacher at the front.","The word is masculine — it takes the article ''el''."]}'::jsonb
WHERE id = '56415272-53a5-5e8c-a30d-f84072653061';

UPDATE exercises SET review_status = 'auto-approved', demotion_reason = NULL
WHERE id IN ('24f67985-f6a6-5e89-bd85-a8e503b06800','23f677f2-7589-50c4-bc85-a74884cd05d1');
```
