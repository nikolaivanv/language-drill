-- ES school vocab_recall repair, applied to prod 2026-11-09.
-- Record + rollback: es-school-vocab-repair-2026-11-09.md

UPDATE exercises SET content_json = content_json || '{"prompt":"The place where children and teenagers go every weekday to have lessons with their teachers — not a university.","_dedupKey":"la escuela::the place where children and teenagers go every weekday to have lessons with their teachers — not a university.","acceptableAnswers":["el colegio"]}'::jsonb
WHERE id = '403d826c-bf22-51b2-9125-990ea7126337' AND review_status = 'auto-approved';

UPDATE exercises SET content_json = content_json || '{"prompt":"The place where children go every weekday to learn to read, write and count with their teachers — not a university.","_dedupKey":"escuela::the place where children go every weekday to learn to read, write and count with their teachers — not a university.","hints":["Most children in a town go to one near their home.","Think of a building full of children and lessons.","It refers to a primary or elementary learning institution."],"acceptableAnswers":["el colegio"]}'::jsonb
WHERE id = 'be7d0476-e36e-5372-9908-66aedadabba3' AND review_status = 'auto-approved';

UPDATE exercises SET content_json = content_json || '{"hints":["Children and teenagers go here, not adults studying for a degree.","Think of a building full of classrooms, teachers, and students aged roughly 6–16.","In Spain it is the everyday word for the school a child goes to."],"acceptableAnswers":["la escuela"]}'::jsonb
WHERE id = '12d57e68-5a8e-503a-8901-f4e6e4f8e05f' AND review_status = 'auto-approved';

UPDATE exercises SET content_json = content_json || '{"prompt":"El lugar donde los niños y los adolescentes van a aprender, con aulas, profesores y recreo. No es la universidad.","_dedupKey":"el colegio::el lugar donde los niños y los adolescentes van a aprender, con aulas, profesores y recreo. no es la universidad.","acceptableAnswers":["la escuela"]}'::jsonb
WHERE id = '1df66e80-7350-553a-8285-b0f68b78b8b7' AND review_status = 'auto-approved';

UPDATE exercises SET content_json = content_json || '{"hints":["Think of a place in your neighborhood where young students carry backpacks and books.","It is a public building — you can find it on most city maps alongside the park and the library.","Parents often take their children there before going to work."],"acceptableAnswers":["el colegio"]}'::jsonb
WHERE id = 'bb92bd43-f599-5c5d-82bb-59b19396bc68' AND review_status = 'auto-approved';

UPDATE exercises SET content_json = content_json || '{"prompt":"A building in the city where children go every weekday to learn with their teachers.","_dedupKey":"la escuela::a building in the city where children go every weekday to learn with their teachers.","hints":["It is a building in the city where children study every day.","Think of a place with teachers, students, and classrooms.","Children usually go there from about age six."]}'::jsonb
WHERE id = '7206209b-5149-5655-b599-35694eb46368' AND review_status = 'auto-approved';

UPDATE exercises SET content_json = content_json || '{"prompt":"A building where children go on weekdays to learn. There are teachers and classrooms inside.","_dedupKey":"la escuela::a building where children go on weekdays to learn. there are teachers and classrooms inside."}'::jsonb
WHERE id = 'e4034c73-e1d7-5207-bdd3-cf6bfd1ea73e' AND review_status = 'auto-approved';

UPDATE exercises SET content_json = content_json || '{"hints":["It is a place in the city where children go every weekday morning.","Think of a building with classrooms, a playground, and a teacher at the front.","Children carry their school bags there every morning."]}'::jsonb
WHERE id = '56415272-53a5-5e8c-a30d-f84072653061' AND review_status = 'auto-approved';

UPDATE exercises SET review_status = 'rejected', demotion_reason = 'duplicate'
WHERE id IN ('24f67985-f6a6-5e89-bd85-a8e503b06800','23f677f2-7589-50c4-bc85-a74884cd05d1') AND review_status = 'auto-approved';
