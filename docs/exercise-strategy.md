# Exercise Strategy

## Design Philosophy

Every exercise must pass the **production test**: does the learner construct language, or just recognize it? Recognition-only drills (multiple choice, matching) are used only as scaffolding within harder exercises, never as standalone practice. The app targets intermediate+ learners stuck at the plateau — people who can understand a language but freeze when they need to produce it.

**Three principles:**

1. **Production over recognition.** Written/spoken output on every exercise. No "tap the right answer" as the main mode.
2. **Graded difficulty, not graded hand-holding.** An A2 exercise and a C1 exercise test the same format — the content gets harder, not the UI simpler.
3. **Every answer teaches.** Wrong answers get targeted feedback. Right answers get refinement suggestions. The evaluation is the learning moment.

---

## Exercise Catalogue

### 1. Cloze (Fill-in-the-Blank)

**Status:** Implemented (MVP)

**What it targets:**
- Grammar accuracy (primary) — tense, agreement, case, mood
- Vocabulary depth (secondary) — collocations, prepositions, register

**How it works:**
- A sentence is presented with one or more blanks (`___`)
- The learner types the missing word(s) into a free text field
- Optional hint mode: multiple choice options are shown as pills (scaffolding, not default)
- Each blank targets a specific grammar point (tagged in the exercise metadata)

**Grading:**
- Claude evaluates the answer in context, returning `score [0–1]`, `grammarAccuracy [0–1]`, `vocabularyRange (CEFR)`, `taskAchievement [0–1]`
- Errors are classified by type (grammar/vocabulary/spelling) and severity (minor/major)
- Acceptable alternatives are recognized (e.g., "have gone" vs "went" depending on context)

**Progress impact:**
- Score updates `mastery` on the targeted grammar point(s) via Bayesian update
- Hard exercise correct → larger mastery increase; easy exercise wrong → larger decrease
- If the student consistently scores >0.8 on a grammar point, it enters spaced repetition maintenance mode
- If the student consistently scores <0.4, the system queues more exercises at the prerequisite grammar level

**Content strategy:** Pre-generated pool. Exercises are batch-created by Claude for each `(language, grammar_point, CEFR_level)` tuple and stored in the database. Each exercise is tagged with the grammar point(s) it tests.

**Getting unstuck:**
1. First attempt: no help, free text input
2. After wrong answer: show the specific error with explanation, offer "Try again" or "Show answer"
3. Optional hint toggle: reveals multiple choice options (reduces the exercise to recognition — the score is weighted lower when hints are used)

---

### 2. Translation (L1 ↔ L2)

**Status:** Implemented (MVP)

**What it targets:**
- Grammar range (primary) — spontaneous use of structures
- Vocabulary depth — word choice, collocations, register
- Discourse/coherence — sentence structure, connector usage

**How it works:**
- A sentence or short paragraph is shown in the source language
- The learner types a translation into the target language (free text input, no word bank)
- Direction matters: L2→L1 tests comprehension; L1→L2 tests production. We heavily favor L1→L2 (production)
- Instructions may constrain register or grammar ("translate using the subjunctive", "use formal register")

**Grading:**
- Claude evaluates against a reference translation but accepts valid alternatives
- Scored on: grammatical accuracy, vocabulary choice, naturalness, register match
- Multiple valid translations are expected — Claude is prompted not to penalize stylistic differences
- Returns the same structured `EvaluationResult` as cloze

**Progress impact:**
- Touches multiple competencies simultaneously (grammar accuracy, vocabulary, discourse)
- Grammar points detected in the user's output are scored individually
- A natural B2 construction used spontaneously is stronger evidence than the same construction elicited by a cloze blank
- Translation exercises produce the richest competency signal because they're open-ended

**Content strategy:** Pre-generated pool, organized by target grammar points and CEFR level. Reference translations stored but Claude evaluates against meaning, not exact match.

**Getting unstuck:**
1. First attempt: just the source sentence
2. "Give me a hint" button: reveals key vocabulary or the target grammatical structure (e.g., "use the subjunctive here")
3. After wrong answer: shows the reference translation, highlights where the user's version diverged, explains the grammar rule
4. Hint usage reduces the score weight for progress tracking (honest signal)

---

### 3. Vocabulary Recall

**Status:** Implemented (MVP)

**What it targets:**
- Vocabulary depth (primary) — active recall from definition/context
- Vocabulary breadth (secondary) — exposure to new words

**How it works:**
- A definition or description is shown (in the target language at higher levels, in L1 at lower levels)
- The learner types the word
- Hints are available: first letter, number of letters, example sentence with the word blanked
- At higher CEFR levels, the definition is in the target language (monolingual mode)

**Grading:**
- Binary core (correct word or not), plus partial credit for close matches (spelling errors, correct root but wrong form)
- Claude evaluates whether the answer is a valid synonym or only-slightly-wrong inflection
- Spelling errors are flagged but may still receive partial score

**Progress impact:**
- Updates the user's vocabulary mastery for that word (passive → active recall score)
- Tracks against frequency lists: "you actively know X of the top 5K words"
- Words that are recalled correctly enter spaced repetition; failed words are re-queued sooner
- Vocabulary coverage feeds into the CEFR estimate (B2 requires ~4K active words in most languages)

**Content strategy:** Pre-generated from frequency lists. Definitions, hints, and example sentences are batch-created by Claude. Higher-frequency words are prioritized for earlier levels.

**Getting unstuck:**
1. Hints revealed progressively: first letter → syllable count → example sentence with blank
2. After failure: show the word, pronunciation, two example sentences, any common confusions
3. The word is automatically scheduled for review in 1 day (short-interval spaced repetition)

---

### 4. Sentence Construction (from prompts)

**Status:** Not yet implemented

**What it targets:**
- Grammar range (primary) — spontaneous production of target structures
- Discourse/coherence — logical sentence construction
- Pragmatics — register, appropriateness

**How it works:**
- The learner is given a prompt: a set of keywords, a situation, or a communicative goal
- Examples:
  - Keywords: `yesterday / library / forget / book` → write a sentence using all four words
  - Situation: "Apologize to your boss for being late, using formal register"
  - Grammar target: "Write a sentence using the past subjunctive to express a wish"
- Free text input, no constraints on length (but the prompt implies roughly one sentence)
- The prompt specifies the grammar point being targeted, but the learner must construct the full sentence

**Grading:**
- Claude evaluates: grammatical accuracy, whether the target structure was used, naturalness, task achievement
- Bonus points for complexity beyond the minimum (e.g., using a subordinate clause when only a simple sentence was required)
- Errors outside the target grammar point are still flagged (don't ignore wrong articles just because you're testing subjunctive)

**Progress impact:**
- Strong signal for grammar range (not just accuracy) — did the user reach for complex structures?
- Updates mastery on the target grammar point plus any other grammar points detected in the response
- The open-ended nature means this exercise type produces the broadest competency signal after free writing

**Content strategy:** Pre-generated prompts, but evaluation is always real-time (Claude). Prompts are cheaper to generate and store than full exercises with reference answers.

**Getting unstuck:**
1. "Show me an example" button: shows a model sentence for a different prompt with the same grammar target (avoids giving away the answer)
2. "Simplify the prompt" button: reduces the constraint set (e.g., removes the register requirement, or gives 2 keywords instead of 4)
3. After submission: Claude provides a "here's another way to say it" alternative, highlighting the target grammar point

---

### 5. Error Correction

**Status:** Not yet implemented

**What it targets:**
- Grammar accuracy (primary) — spotting and fixing errors
- Metalinguistic awareness — understanding why something is wrong

**How it works:**
- A sentence with 1–3 deliberate errors is presented (grammar, vocabulary, or spelling)
- The learner must:
  1. Identify the error(s) — tap or highlight the problematic word/phrase
  2. Provide the corrected version — free text input for each error
- Errors are realistic (based on common L2 mistakes for that language pair, not random)
- At higher levels: the sentence may be correct, and the learner must recognize this ("no errors")

**Grading:**
- Two-part score: identification (did they find the right error?) + correction (is the fix right?)
- Partial credit: found the error but wrong correction, or correct intent but wrong form
- "No errors" traps: if the student marks a correct sentence as wrong, that's a negative signal for that grammar point

**Progress impact:**
- Directly updates grammar accuracy mastery for the specific grammar point(s) containing errors
- Error correction is a weaker production signal than sentence construction (it's partially recognition), so the mastery update weight is lower
- But it's excellent for fine-tuning: distinguishing ser/estar, preterite/imperfect, accusative/dative

**Content strategy:** Pre-generated. Errors are systematically drawn from common L2 interference patterns for each language pair (e.g., English speakers learning Spanish consistently confuse ser/estar). Claude generates the incorrect sentences with tagged error types.

**Getting unstuck:**
1. "How many errors?" hint: reveals the error count
2. "Show me the area" hint: highlights the clause containing the error (not the exact word)
3. After submission: full explanation of each error with the underlying grammar rule, plus a correct example

---

### 6. Paragraph / Free Writing

**Status:** Not yet implemented

**What it targets:**
- Writing (macro-skill) — all sub-competencies
- Discourse/coherence — paragraph structure, connectors, flow
- Grammar range — structures the learner reaches for naturally
- Pragmatics — register, tone, audience awareness

**How it works:**
- The learner receives a writing prompt with constraints:
  - Topic (e.g., "Describe your ideal weekend", "Argue for or against remote work")
  - Target length (50–200 words depending on level)
  - Register (informal/formal/academic)
  - Required elements (e.g., "use at least two conditional sentences", "include a counterargument")
- Free text input in a multi-line text area
- A word/character counter is shown
- Timer is optional (for exam simulation mode)

**Grading:**
- Claude evaluates on IELTS-style criteria adapted per language:
  - **Task achievement** [0–1]: did they address the prompt, meet length, include required elements?
  - **Coherence & cohesion** [0–1]: logical flow, paragraph structure, connector usage
  - **Lexical resource** [0–1]: vocabulary range, accuracy, appropriateness
  - **Grammatical range & accuracy** [0–1]: variety of structures used correctly
- Each criterion gets a CEFR-level estimate
- Detailed error markup: each error is located in the text with type, severity, and correction
- An "improved version" is provided — the student's text with corrections and enhancements, so they can compare

**Progress impact:**
- The richest signal source in the app. A single paragraph touches grammar, vocabulary, discourse, and pragmatics
- Updates multiple competency mastery scores simultaneously
- Grammar points used correctly → mastery up; grammar points used incorrectly → mastery down; grammar points avoided (expected at this level but missing) → no change (absence of evidence, not evidence of absence)
- Feeds directly into Writing macro-skill CEFR estimate
- Exam readiness: writing exercises with exam-style prompts directly calibrate IELTS Writing / DELE Expresión Escrita predictions

**Content strategy:** Prompts are pre-generated per (language, CEFR level, topic domain). Evaluation is always real-time Claude. Prompts are simple to generate in bulk; the value is in the evaluation.

**Getting unstuck:**
1. "Brainstorm" button: Claude generates a bullet-point outline for the topic (ideas, not sentences)
2. "Vocabulary boost" button: shows 8–10 useful words/phrases for the topic at the learner's level
3. "Start my paragraph" button: provides an opening sentence the learner can continue (score weight reduced for the provided sentence)
4. After submission: side-by-side view of original and corrected version with inline annotations

---

### 7. Listening Comprehension

**Status:** Not yet implemented (requires AWS Polly integration)

**What it targets:**
- Listening (macro-skill) — comprehension of spoken language
- Phonology (receptive) — processing natural speech, connected speech phenomena
- Vocabulary breadth — recognizing words in audio context

**How it works:**
- Audio is played (generated by AWS Polly neural voices)
- Multiple exercise sub-types:
  - **Dictation**: listen and type what you hear (full or partial). Tests phoneme discrimination, spelling, and word boundaries.
  - **Comprehension questions**: listen to a passage, then answer questions about content. Questions are open-ended (typed answer), not multiple choice.
  - **Gap fill from audio**: listen to a sentence, fill in the missing word(s) that were beeped out / replaced with silence. Tests prediction and phonological processing.
- Playback controls: play, pause, replay (limited replays at higher levels — simulates exam conditions)
- Speed control: 0.8x / 1.0x / 1.2x (slower for lower levels, faster for exam prep)

**Grading:**
- Dictation: character-level comparison + Claude evaluation for acceptable alternatives (contractions, homophones)
- Comprehension: Claude evaluates the answer against the passage content. Graded on accuracy and completeness.
- Gap fill: exact match with tolerance for minor spelling errors

**Progress impact:**
- Updates Listening macro-skill CEFR estimate
- Dictation exercises update phonology (receptive) competency
- Comprehension questions update vocabulary breadth (did they understand the words?) and discourse (did they follow the argument?)
- Replays are tracked: fewer replays at the same accuracy → higher listening proficiency signal

**Content strategy:** Pre-generated. Audio files are created via AWS Polly (neural voices for each language: EN/ES/DE/TR all supported) and stored in S3. The text content, questions, and answers are generated by Claude and stored in the database. Audio generation is a background Lambda job.

**Getting unstuck:**
1. "Replay" button (limited count, tracked)
2. "Slow down" button: replays at 0.8x speed
3. "Show transcript" button: reveals the text (exercise becomes reading, not listening — score weight adjusted)
4. After submission: transcript is shown with the words they missed highlighted

---

### 8. Speaking (Prompted Speech)

**Status:** Not yet implemented (requires MediaRecorder + AWS Transcribe)

**What it targets:**
- Speaking (macro-skill) — all sub-competencies
- Phonology (productive) — pronunciation, stress, intonation
- Grammar range — structures used in spontaneous speech
- Vocabulary depth — active recall under time pressure

**How it works:**
- A prompt is shown on screen (same types as sentence construction / free writing, but spoken)
- Exercise sub-types:
  - **Read aloud**: a text is shown; the learner reads it aloud. Tests pronunciation, stress, rhythm. (Simplest speaking exercise — good entry point.)
  - **Describe the image**: a photo or illustration is shown; the learner describes it in 30–60 seconds. Tests vocabulary recall and spontaneous grammar.
  - **Respond to a question**: an audio question is played; the learner speaks a response. Tests listening + speaking in combination.
  - **Role play**: a scenario is described; the learner speaks their part. Tests pragmatics, register, communicative competence.
- Recording: browser MediaRecorder API captures audio
- Processing: audio is sent to AWS Transcribe for speech-to-text, then the transcript is evaluated by Claude
- Optional: pronunciation scoring via phoneme-level comparison (Transcribe provides word confidence scores)

**Grading:**
- Transcript is evaluated by Claude on the same criteria as written production: grammar, vocabulary, task achievement
- Additional speaking-specific scores:
  - **Fluency**: ratio of speech to silence, filler word count, self-correction count (derived from Transcribe timing data)
  - **Pronunciation**: Transcribe word confidence scores as a proxy (low confidence = unclear pronunciation)
- Combined score: content (70%) + delivery (30%)

**Progress impact:**
- Updates Speaking macro-skill CEFR estimate
- Grammar and vocabulary from the transcript update the same competency scores as written exercises
- Fluency metrics (speech rate, filler ratio) track Speaking-specific progress over time
- Pronunciation scores update phonology (productive) competency
- Speaking produces weaker grammar signal than writing (people use simpler structures verbally) — this is accounted for in the update weight

**Content strategy:** Prompts are pre-generated (same pool can be shared with sentence construction / free writing). Audio questions for "respond to a question" sub-type are generated via Polly. Evaluation is always real-time Claude on the transcript.

**Getting unstuck:**
1. "Preparation time" toggle: 15–30 seconds to think before recording starts
2. "Show key vocabulary" button: reveals useful words for the prompt
3. "Let me try again" button: re-record (the best attempt is scored, but all attempts are logged for fluency trend tracking)
4. After submission: transcript is shown with corrections, plus an AI-generated "model answer" audio (via Polly)

---

### 9. Dialogue Completion

**Status:** Not yet implemented

**What it targets:**
- Pragmatics (primary) — register, turn-taking, politeness strategies
- Grammar accuracy — in conversational context
- Vocabulary depth — conversational language, idioms, colloquial expressions

**How it works:**
- A multi-turn conversation is shown with one or more turns missing (the learner's part)
- Context: who the speakers are, the setting, the relationship (formal/informal)
- The learner types their response for each missing turn (free text)
- The surrounding dialogue provides context clues for register and content
- At higher levels: the learner must infer the relationship and register from context alone

**Grading:**
- Claude evaluates: pragmatic appropriateness, grammatical accuracy, naturalness, register match
- A grammatically perfect response in the wrong register scores low on pragmatics
- Multiple valid responses are expected — Claude evaluates plausibility, not exact match

**Progress impact:**
- Primary signal for pragmatics competency (the only exercise that directly tests this)
- Updates grammar and vocabulary mastery as secondary signals
- Register awareness contributes to the CEFR estimate (B2+ requires register flexibility)

**Content strategy:** Pre-generated dialogue shells with blanks. Dialogues are tagged by register (formal/informal/academic) and situation type (service encounter, social, professional, academic). Evaluation is real-time Claude.

**Getting unstuck:**
1. "Who am I talking to?" hint: reveals relationship and expected register if not already explicit
2. "Show me a possible start" hint: provides the first few words of a valid response
3. After submission: Claude shows an alternative valid response and explains any register mismatches

---

### 10. Contextual Paraphrase

**Status:** Not yet implemented

**What it targets:**
- Vocabulary depth (primary) — synonyms, circumlocution, range
- Grammar range — alternative structures for the same meaning
- Discourse — restructuring information flow

**How it works:**
- A sentence is shown with a constraint: "Say the same thing without using [word/structure]"
- Or: "Rewrite this sentence in [formal/informal/academic] register"
- Or: "Simplify this for a [child / non-expert / casual conversation]"
- Free text input
- At higher levels: "Rewrite this three different ways" (tests range, not just accuracy)

**Grading:**
- Claude evaluates: meaning preservation, adherence to constraints, grammatical accuracy, naturalness
- Bonus for creative solutions that demonstrate vocabulary/grammar range beyond the minimum
- Penalized if the paraphrase changes the meaning or violates the constraint

**Progress impact:**
- Strong signal for vocabulary depth and grammar range (the learner must access alternatives, not just their default structure)
- Register-shifting variants update pragmatics competency
- Multiple-paraphrase variants produce the strongest vocabulary range signal

**Content strategy:** Pre-generated sentences with constraints. The constraint type (avoid word, change register, simplify) is metadata. Evaluation is real-time Claude.

**Getting unstuck:**
1. "Show me a synonym for [banned word]" hint: reveals one alternative word (not a full paraphrase)
2. "What structure could I use?" hint: suggests a grammatical alternative (e.g., "try passive voice")
3. After submission: Claude shows 2–3 alternative paraphrases to broaden the learner's repertoire

---

### 11. Mini-Essay Outline & Argument

**Status:** Not yet implemented (Phase 3+)

**What it targets:**
- Discourse/coherence (primary) — argument structure, logical flow
- Writing (macro-skill) — extended production
- Grammar range — complex structures in context

**How it works:**
- A debate topic is given (e.g., "Should public transport be free?")
- Two-part exercise:
  1. **Outline**: the learner writes a bullet-point outline (thesis, 2–3 supporting points, counterargument, conclusion)
  2. **Paragraph**: the learner writes one full paragraph expanding one of their points
- This is a stepping stone to full essay writing (IELTS Writing Task 2, DELE Expresión Escrita)

**Grading:**
- Outline: Claude evaluates logical structure, argument strength, counterargument quality
- Paragraph: same criteria as free writing, with extra weight on coherence and argumentation
- Combined score reflects both planning ability and execution

**Progress impact:**
- Primary signal for discourse/coherence competency
- Direct calibration for exam writing sections (IELTS Task 2, DELE Expresión Escrita)
- At C1+, this is a core exercise — discourse mastery is what separates B2 from C1

**Content strategy:** Pre-generated topics tagged by domain (social, academic, professional, ethical). Evaluation is real-time Claude.

---

### 12. Picture Description

**Status:** Not yet implemented (Phase 3 written variant; Phase 6 spoken variant)

> Promotes the "Describe the image" speaking sub-type (Exercise 8) to a first-class type and adds a **written** variant. The pedagogy fits cleanly; the open question is the **image asset pipeline**, which is a new asset class the rest of the catalogue doesn't need.

**What it targets:**
- Vocabulary depth (primary) — concrete nouns, and *circumlocution* when the exact word is missing
- Grammar accuracy/range — spatial prepositions, continuous tenses, existential constructions ("there is/are")
- Discourse/coherence — organizing a description (general → specific, foreground → background)

**Why it fits the plateau:** when an intermediate learner doesn't know the word for something in the image, they're forced to describe it with vocabulary they *do* have. Building that fluid workaround skill is exactly what breaks the freeze. And unlike a debate prompt, a picture carries **zero brainstorming load** — the learner spends all cognitive budget on language, not on inventing content. Images can be chosen to *elicit specific targets* (a busy kitchen scene forces prepositions of place and continuous tenses).

**How it works:**
- An image is shown; the learner produces a description
  - **Written variant (Phase 3):** type a 50–100-word description in a multi-line field. Reuses the free-writing UI.
  - **Spoken variant (Phase 6):** describe the image aloud in 30–60s → Transcribe → evaluate (the existing Exercise 8 sub-type).
- Difficulty scales by image complexity and by constraint ("describe only the foreground", "use the present continuous", "include three prepositions of place"), not by simplifying the UI.
- **Information-gap variant (harder):** Claude describes a *slightly different* version of the image via text/audio; the learner compares it to their picture and produces the differences. This hardens the production test — the learner must generate language tied to specific observed content rather than reciting a memorized template.

**Grading:**
- Returns the standard `EvaluationResult` (lexical resource, grammatical accuracy, task achievement), plus a description-specific check on spatial-preposition use and coverage of salient objects.
- **Open decision — how does Claude grade a picture it can't see?**
  - **(a) Reference-tag grading (cheaper, default):** at generation time, store a Claude-authored reference description + an object/preposition tag list alongside each image. Eval stays text-only and cheap, but may under-credit valid observations the reference didn't enumerate.
  - **(b) Vision grading (richer, costlier):** send the image to Claude vision (`claude-sonnet-4-6` is multimodal) at eval time. More forgiving of valid-but-unlisted observations, but every submission now carries an image in the prompt — higher token cost, different eval-call shape.
  - Recommendation: ship the written variant with **(a)** first; consider **(b)** only if reference-tag grading proves too strict in practice.

**Progress impact:**
- Strong signal for vocabulary depth (concrete lexis + circumlocution) and for spatial grammar that other exercises rarely exercise.
- Spoken variant feeds the Speaking macro-skill; written variant feeds Writing.

**Content strategy:** Pre-generated, but with a **new asset class — the images themselves.** This is the real cost, and it is not in the current stack (text + Polly audio only). S3 + CloudFront already cover *hosting*; *sourcing* is unsolved:
- **AI-generated images** (recommended) — a generation model lets us design scenes that elicit specific grammar/vocabulary targets and sidesteps stock-photo licensing, but adds a new pipeline, a new model dependency, and per-image cost.
- **Licensed stock photos** — no generation pipeline, but licensing cost, curation effort, and weaker control over elicitation targets.
- Either way, the image + its reference description/tags are generated once and reused across all users (same amortization as the rest of the pool). Text evaluation remains real-time Claude.

**Getting unstuck:**
1. "Vocabulary boost" button: 8–10 useful words for the objects/actions in the scene at the learner's level
2. "What should I cover?" hint: names a region of the image to describe (foreground / the people / the setting) without giving sentences
3. After submission: model description shown side-by-side, with missed salient objects and any preposition errors highlighted

---

### 13. Task-Based Role-Play (Goal-Oriented Dialogue)

**Status:** Not yet implemented (Phase 4+, own milestone)

> The deepest expression of the tagline — _"what you do between italki sessions."_ It upgrades Dialogue Completion (Exercise 9) from a static fill-the-blank shell into a **dynamic, multi-turn simulation**. It is also the **one exercise type that legitimately reopens a closed decision** ("pre-generate content pool rather than generate-on-demand"), because the interaction *is* the product and cannot be pre-baked. We honor cost discipline through **metering and turn caps**, not pre-generation.

**What it targets:**
- Pragmatics (primary) — register, politeness, turn-taking under live pressure
- Task achievement (heavily weighted) — did the learner actually accomplish the goal (buy the correct ticket, get the directions, resolve the work request)?
- Grammar accuracy + vocabulary depth — in spontaneous conversational context

**Why it fits the plateau:** real-world problem-solving — a service encounter, asking for missing information, navigating a workplace task — is precisely where intermediate learners freeze. This gives them a safe sandbox to fail and retry, simulating the exact situations that immersion throws at expats and professionals.

**How it works:**
- The learner is given a **goal** and a **scenario** ("You're at the station. Buy a return ticket to Munich, second class, and ask whether you need to reserve a seat."), plus the relationship/register.
- One or more virtual characters (NPCs) respond over multiple turns; the learner must extract missing information or persuade/transact to reach the goal.
- The dialogue ends when the goal is reached, the learner gives up, or a **hard turn cap** is hit (e.g. 6–8 learner turns).

**The architectural tension (and how we resolve it):** every turn needs a live LLM response, which breaks the pre-generated pool. Two ways to contain it:
- **Finite-state branching (rejected as the primary model):** pre-generate NPC turns as a branch tree; Claude only *classifies* the learner's input into branch A/B. Keeps every call cheap — but branch trees explode combinatorially, real conversations don't branch cleanly, and forcing a state machine constrains naturalness, which **partly defeats the point** (a free sandbox). Usable for tightly scripted A1–A2 transactional scenarios; too rigid above that.
- **Metered live generation (recommended):** treat role-play as the deliberate **real-time exception**, bounded by a hard turn cap and a dedicated usage bucket, served by the metering infra that already exists (Upstash counters, per-bucket daily limits, boosted-tier 10×). To keep NPCs from hallucinating or breaking character, constrain them with a tight system prompt (persona + goal-state + allowed information), not with a pre-baked tree.
  - New usage bucket (per `infra/lambda/src/usage/limits.ts`): e.g. `ai_roleplay`, capped low on the free tier because each *session* spends several calls. Each NPC turn + the final evaluation count against it. Tune the free/boosted caps against observed per-session cost.

**Grading:**
- Evaluated at the **conversation level**, not per turn: Claude scores task achievement (was the goal met?), pragmatic appropriateness/register across the whole exchange, and grammatical accuracy + vocabulary from the learner's turns.
- This is a **richer evaluation than anything currently built** — it must track goal state and register over multiple turns, not score a single utterance.

**Progress impact:**
- Primary signal for pragmatics *and* task achievement under live conditions — closer to real communicative competence than any other exercise.
- Updates grammar/vocabulary mastery as secondary signals (weaker per-turn, like Speaking, since spontaneous speech uses simpler structures).

**Content strategy:** **Scenario + goal + NPC persona** are pre-generated and reusable across users (tagged by register and situation type — service, social, professional, bureaucratic). The **dialogue itself is real-time, metered** (see above). Evaluation is real-time Claude.

**Getting unstuck:**
1. "What do I need to find out?" hint: restates the goal and the still-missing information
2. "Suggest a phrase" hint: offers one register-appropriate opener for the current turn (not a full line)
3. After the session: a transcript with register notes per turn, a "did you reach the goal?" verdict, and a model run of the same scenario

---

## Summary Table

| # | Exercise | Skill Target | Input Mode | Audio? | CEFR Range | Content | Eval |
|---|----------|-------------|------------|--------|------------|---------|------|
| 1 | Cloze | Grammar accuracy | Text (short) | No | A1–C2 | Pre-gen | Claude |
| 2 | Translation | Grammar range, vocab | Text (sentence) | No | A2–C2 | Pre-gen | Claude |
| 3 | Vocabulary Recall | Vocab depth/breadth | Text (word) | No | A1–C2 | Pre-gen | Claude |
| 4 | Sentence Construction | Grammar range, pragmatics | Text (sentence) | No | A2–C2 | Pre-gen prompts | Claude |
| 5 | Error Correction | Grammar accuracy | Tap + text | No | A2–C2 | Pre-gen | Claude |
| 6 | Paragraph / Free Writing | Writing (all) | Text (long) | No | B1–C2 | Pre-gen prompts | Claude |
| 7 | Listening Comprehension | Listening, phonology | Text (typed answer) | Playback | A2–C2 | Pre-gen + Polly | Claude |
| 8 | Speaking | Speaking (all) | Voice recording | Record + Play | A2–C2 | Pre-gen prompts + Polly | Transcribe + Claude |
| 9 | Dialogue Completion | Pragmatics, register | Text (sentence) | No | B1–C2 | Pre-gen | Claude |
| 10 | Contextual Paraphrase | Vocab depth, grammar range | Text (sentence) | No | B1–C2 | Pre-gen | Claude |
| 11 | Mini-Essay & Argument | Discourse, coherence | Text (long) | No | B2–C2 | Pre-gen topics | Claude |
| 12 | Picture Description | Vocab depth, spatial grammar | Text (long) / Voice | Image (+ Record for spoken) | A2–C2 | Pre-gen images + tags | Claude (text or vision) |
| 13 | Task-Based Role-Play | Pragmatics, task achievement | Text (multi-turn) | No | A2–C2 | Pre-gen scenario; **live metered** dialogue | Claude (conversation-level) |

---

## How Grading Affects the Learning Plan

The grading system doesn't just record scores — it drives what the student sees next.

### Adaptive exercise selection

The system selects exercises based on the learner's current competency profile:

1. **Growth zone targeting**: exercises are chosen where the learner's mastery is between 0.3 and 0.7 (the zone of proximal development). Below 0.3 means prerequisites are missing; above 0.7 means maintenance (spaced repetition handles this).

2. **Weakness amplification**: if a learner's grammar accuracy lags behind their vocabulary, the system biases toward grammar-heavy exercises (cloze, error correction, sentence construction with grammar constraints).

3. **Skill balancing**: if the learner's Speaking CEFR estimate is a full level below their Writing, speaking exercises are prioritized in the recommended queue.

4. **Spaced repetition integration**: grammar points and vocabulary items that are due for review are woven into the exercise queue. A cloze exercise might target a grammar point the learner mastered 2 weeks ago — maintenance, not new learning.

5. **Difficulty calibration**: the system targets exercises where the learner is expected to score 60–80% (the sweet spot for learning — challenging but not discouraging). If they're scoring >90%, the difficulty level is bumped. If <40%, it's decreased or prerequisites are surfaced.

### After each exercise

```
submission
  → Claude evaluation (structured JSON)
  → update grammar point mastery (Bayesian)
  → update competency mastery (roll-up)
  → update vocabulary mastery (if applicable)
  → recalculate CEFR estimate (if enough new evidence)
  → adjust spaced repetition schedule
  → re-rank exercise queue for next recommendation
```

### Session-level adaptation

Within a single practice session (5–15 exercises):
- If the learner gets 3+ exercises right in a row on the same grammar point, move to a different point
- If they get 2+ wrong on the same point, switch to an easier exercise on the same point (scaffolding down)
- Mix exercise types within a session to maintain engagement and test transfer (knowing a grammar rule in cloze doesn't mean you can produce it in free writing)
- End the session with a "win" — the last exercise should be at or slightly below current level

---

## Implementation Order

The order balances three factors: learning impact (does this exercise type produce strong competency signals?), technical complexity (what infrastructure does it require?), and user experience (does the app feel useful with just this exercise set?).

### Phase 1 — Core text production (MVP)
Already implemented: Cloze, Translation, Vocabulary Recall

These three cover grammar accuracy, grammar range, and vocabulary — the foundation. The app is usable with just these, though limited.

### Phase 2 — Deeper production
1. **Sentence Construction** — high learning impact, low technical complexity. Reuses the same Claude evaluation pipeline. Bridges the gap between guided (cloze) and free (paragraph) production.
2. **Error Correction** — high learning impact for grammar accuracy fine-tuning. Technically simple (text in, text out). Particularly valuable for tricky grammar distinctions (ser/estar, cases, aspect).

### Phase 3 — Extended writing
3. **Paragraph / Free Writing** — the highest-value exercise for intermediate+ learners, but requires a richer evaluation UI (inline error markup, side-by-side comparison). The evaluation prompt is more complex.
4. **Contextual Paraphrase** — builds vocabulary range and grammar flexibility. Simple UI, moderate evaluation complexity.
5. **Picture Description (written variant)** — reuses the free-writing UI and evaluation, so the *exercise* logic is cheap. The gating work is the **image asset pipeline** (sourcing/generating images + reference-tag grading), a new asset class not needed elsewhere. Sequence it after free writing so the eval UI already exists; resolve the image-sourcing decision before committing.

### Phase 4 — Pragmatics & discourse
6. **Dialogue Completion** — introduces pragmatics (register, politeness, turn-taking). Requires a conversation-display UI but no new infrastructure.
7. **Mini-Essay & Argument** — for B2+ learners preparing for exams. Extends the free writing evaluation with discourse/argumentation criteria.
8. **Task-Based Role-Play** — *own milestone, heavier than the rest of Phase 4.* The only type that reopens the pre-generation decision: it needs a **new metered usage bucket** (`ai_roleplay`, turn-capped) and **conversation-level evaluation** (goal-state + register over multiple turns). Build it on top of the Dialogue Completion UI, but treat it as a distinct, metered feature rather than folding it in. Defer until the metering model and per-session cost are validated.

### Phase 5 — Audio (listening)
9. **Listening Comprehension** — requires AWS Polly integration, S3 storage for audio files, audio player UI, and a background Lambda for batch audio generation. Technically the biggest lift so far, but listening is a core macro-skill that has been entirely untested until this point.

### Phase 6 — Audio (speaking)
10. **Speaking** — requires MediaRecorder API, AWS Transcribe integration, and a pipeline to send audio → transcribe → evaluate. The most technically complex exercise type. Deferred because it adds the most infrastructure but the evaluation quality depends on Transcribe accuracy, which varies by language and accent.
11. **Picture Description (spoken variant)** — once the speaking pipeline exists, the written Picture Description (#12) gains a spoken mode at near-zero marginal cost: same images, same reference-tag grading, audio → Transcribe → evaluate. This is the existing "Describe the image" sub-type of Speaking, now backed by a real image pool.

---

## Vocabulary Acquisition

Vocabulary is not a separate mode — it's a byproduct of doing production exercises at the right difficulty level. Flashcard apps (Anki, Memrise) already do isolated vocab drilling well; our edge is production practice with AI evaluation. The vocabulary system has three layers.

### Layer 1 — Learn through exercises (primary, already happening)

Every exercise naturally introduces and reinforces vocabulary. Translation exercises force active recall. Cloze exercises test collocations. Free writing pushes learners to reach for words. Claude's feedback already flags vocabulary issues and suggests better word choices. This is the main vocabulary acquisition channel.

### Layer 2 — Personal word bank (post-exercise capture)

After each exercise evaluation, the system surfaces new/difficult words the learner encountered:

- Words Claude corrected or suggested as alternatives
- Words from the exercise content that the learner likely doesn't know (inferred from their level)
- Each word is saved with the sentence it appeared in (context > definition)

The word bank feeds into spaced repetition — vocab recall and cloze exercises are generated from the learner's *own encountered words*, not a generic list.

**Pipeline:**

```
User does exercise
  → Claude evaluation mentions: "better word: 'escasez' instead of 'falta'"
  → "escasez" added to personal word bank (with source sentence, context, CEFR tag)
  → Next session: system checks word bank for items due for review
  → Generates a cloze/translation exercise featuring "escasez" on the fly
  → Single Claude call, cached system prompt, just the content varies
```

**Word bank data model:**

```
user_vocabulary (
  user_id, language, word, lemma,
  source_sentence TEXT,        -- where they encountered it
  source_exercise_id UUID,     -- which exercise surfaced it
  frequency_band TEXT,         -- LLM-classified: top1k / 3k / 10k / 10k+
  active_recall FLOAT,        -- 0.0–1.0 mastery
  passive_recognition FLOAT,
  times_reviewed INT,
  next_review_at TIMESTAMP,   -- spaced repetition
  added_at TIMESTAMP
)
```

### Layer 3 — Reading integration (Phase 3+)

A lightweight "paste a text" feature connects external reading to the exercise pipeline:

- Learner pastes a paragraph from a book or article they're reading
- Claude highlights words above their estimated level, provides definitions
- Learner marks words they want to learn → added to their word bank
- Those words later appear in cloze / vocab recall / translation exercises

This respects the fact that learners read outside the app, and connects that external input to our exercise pipeline without trying to build a reading app.

### How personal exercises coexist with the batch pool

| | Batch pool | Personal word bank |
|---|---|---|
| When generated | Background Lambda job | On-demand or mini-batch before session |
| Shared across users | Yes | No |
| Content source | Grammar curriculum + frequency bands | User's own encounters |
| Stored permanently | Yes (DB) | Exercises are ephemeral, word bank is permanent |
| Cost per exercise | Amortized to near-zero | ~$0.001 per generation call |

Personal word exercises don't replace pool exercises — they're woven in. A typical session of 10 exercises might be 7 from the pool (targeting grammar/skills) + 3 personal word reviews. The ratio adapts based on how many words are due for review.

**Why this is cheap enough:**
- Exercise generation is a short Claude call (~200 tokens out) — much cheaper than evaluation
- You only generate when words are due for review (spaced repetition), not every session
- The system prompt is cached — you're only paying for the variable part (the specific word + context)
- You can batch: if a user has 8 words due, one Claude call generates all 8 exercises

### What we don't do

- Standalone vocabulary lessons (word lists, flashcard decks) — Anki does this better, and it's recognition not production
- Gamified vocab games (word matching, crosswords) — contradicts our "no gamification" principle
- Teaching vocabulary divorced from grammar context — knowing a word means knowing its collocations, register, and grammar patterns

---

## Content Generation Strategy

### Pre-generated pool (default for all exercise types)

All exercises are pre-generated by Claude in background Lambda batches and stored in the database. This is critical for cost control — generating exercises on-the-fly for every user session would burn through the API budget.

**Batch generation dimensions:**
- Language (EN, ES, DE, TR)
- CEFR level (A1–C2)
- Exercise type (cloze, translation, etc.)
- Grammar point (from the per-language curriculum)
- Topic domain (everyday, academic, professional, travel)

**Pool size target:** ~50 exercises per (language, CEFR level, exercise type, grammar point) combination. With 4 languages × 6 levels × 11 types × ~20 grammar points per level, that's a substantial pool, but exercises are reusable across users.

**Quality control:** Generated exercises are validated by a second Claude pass (checking for ambiguous answers, cultural sensitivity, appropriate difficulty). Flagged exercises are queued for human review.

### Real-time AI (metered, per-user)

Used for:
- **Answer evaluation** (every submission) — this is the core AI cost and cannot be pre-generated
- **Personalized explanations** — when the learner asks "why?" after a correction
- **Custom exercise requests** — "give me more exercises on the subjunctive" generates on-the-fly
- **Level assessment** — initial placement and periodic recalibration

**Rate limiting:** 50 evaluations per user per day (free tier). Pro tier: unlimited. Tracked via Upstash Redis counters.

### Prompt caching

System prompts (language profile, exercise format, grading rubric) are cached with Anthropic's prompt caching. Since the rubric is the same for all users evaluating the same exercise type, this achieves ~80% cost reduction on prompt tokens.

---

## Hint System Design

Hints follow a consistent pattern across all exercise types:

### Progressive disclosure
1. **Level 1** — structural hint (how many errors, what grammar area, what word class)
2. **Level 2** — content hint (first letter, a synonym, the clause containing the issue)
3. **Level 3** — reveal answer (show the solution with full explanation)

### Scoring impact
- No hints used: full score weight for progress tracking
- Level 1 hint: 80% score weight
- Level 2 hint: 50% score weight
- Level 3 (reveal): 0% score weight for mastery update, but the item is scheduled for spaced repetition review (the learner saw the answer, so test retention later)

### "Try again" vs "Show answer"
After a wrong answer, the learner always has both options. "Try again" preserves the learning opportunity. "Show answer" is never hidden — forcing a stuck learner to guess repeatedly is counterproductive. But the scoring reflects the difference.

### No penalty for using hints
Hints reduce the progress signal weight, but they never reduce the learner's mastery score. Using a hint is always better than giving up. The system treats a hint-assisted correct answer as weaker evidence, not negative evidence.
