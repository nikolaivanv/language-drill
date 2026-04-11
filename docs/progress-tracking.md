# Progress Tracking Design

## Core Principle

Track **demonstrated ability**, not activity. The system answers:
> "What can this user actually do in the language, and how does that compare to recognized proficiency benchmarks?"

All progress maps to **CEFR** (A1–C2) — the framework underlying IELTS, DELE, Goethe-Zertifikat, YDS, and every other major exam. This gives us a single spine across all four languages, and makes exam readiness a natural output of the same data we already collect.

---

## The Skill Taxonomy (3 Layers)

### Layer 1 — Macro-skills (what exams test)

| Skill | What it measures |
|---|---|
| **Listening** | Comprehension of spoken language |
| **Reading** | Comprehension of written language |
| **Writing** | Production of written language |
| **Speaking** | Production of spoken language |

These map 1:1 to IELTS bands, DELE sections, Goethe subsections, etc.

### Layer 2 — Enabling competencies (what underlies fluency)

These cut across all macro-skills and are the actual levers for improvement:

| Competency | What it means |
|---|---|
| **Vocabulary breadth** | How many words the user knows passively |
| **Vocabulary depth** | Active recall, collocations, register, nuance |
| **Grammar accuracy** | Correctness of specific grammar constructions |
| **Grammar range** | Complexity of structures used spontaneously |
| **Discourse / Coherence** | Logical flow, connectors, text structure |
| **Pragmatics** | Register, idioms, culturally appropriate usage |
| **Phonology (receptive)** | Processing natural speech speed, accents |
| **Phonology (productive)** | Intelligibility, stress, rhythm |

### Layer 3 — Granular grammar & vocabulary points

Each language has a grammar curriculum mapped to CEFR levels. Every grammar point is individually tracked.

**Example — Spanish:**
| CEFR | Grammar points |
|---|---|
| A1 | Present tense (regular), ser/estar, definite/indefinite articles, gender agreement |
| A2 | Preterite, imperfect, reflexive verbs, comparatives, gustar-type verbs |
| B1 | Present subjunctive, conditional, relative clauses, passive with se |
| B2 | Past subjunctive, compound tenses, complex conditionals, nuanced ser/estar |
| C1 | Subjunctive in complex clauses, stylistic inversion, nominalization |
| C2 | Register variation, archaic/literary forms, rhetorical structures |

**Example — English (IELTS-oriented):**
| CEFR | Grammar points |
|---|---|
| A2 | Simple/continuous tenses, modal verbs (can/must), basic connectors |
| B1 | Perfect tenses, passive voice, reported speech, relative clauses |
| B2 | Advanced conditionals, inversion for emphasis, cleft sentences |
| C1 | Subjunctive, complex nominalization, academic hedging language |

**Vocabulary tracking:**
- Indexed against frequency lists (top 1K, 5K, 10K, 20K words per language)
- Separate active recall score vs. passive recognition score per word
- Topic domain tagging (academic, everyday, formal, travel, profession-specific)

---

## Measurement Approach

### Exercise response → competency signal

Every exercise produces structured evaluation data. Claude grades free-form responses (written or transcribed speech) on relevant dimensions and returns a structured JSON payload:

```json
{
  "grammar_accuracy": 0.82,
  "vocabulary_range": "B1",
  "task_achievement": 0.9,
  "coherence": 0.75,
  "errors": [
    {
      "type": "grammar",
      "point": "past_subjunctive_es",
      "severity": "major",
      "correction": "..."
    }
  ],
  "estimated_cefr_evidence": "B1"
}
```

This feeds into the competency mastery model below.

### Mastery model (per grammar point / competency)

Each competency has a mastery score and a confidence value:

```
mastery ∈ [0.0, 1.0]   — estimated ability on this competency
confidence ∈ [0.0, 1.0] — how sure we are (more evidence = higher confidence)
```

**Update rule (simplified Bayesian):**
- Correct answer on a hard exercise → larger mastery increase
- Error on an easy exercise → larger mastery decrease
- Recent evidence is weighted more than old (exponential decay)
- Confidence grows with evidence count, decays with time since last attempt

This is inspired by Item Response Theory (IRT) — the same psychometric model that IELTS and DELE use to calibrate their questions.

**Forgetting curve:**
- Mastery decays over time without practice (based on Ebbinghaus curve)
- Rate of decay is slower for high-mastery items (well-consolidated knowledge)
- Spaced repetition scheduling is derived from this decay estimate

### CEFR level estimation

CEFR level per macro-skill is estimated as:

```
cefr_estimate = f(grammar_mastery, vocabulary_mastery, macro_skill_performance)
```

Concretely:
- A user is estimated at **B1 in Writing** when:
  - Their grammar mastery for A1+A2+B1 points averages > 0.75
  - Their vocabulary depth (active recall) covers > 70% of the B1 frequency band
  - Their writing exercise scores consistently score in the B1 CEFR descriptor range
  - No B2 grammar points are reliably demonstrated yet
- The estimate is a **probability distribution** over levels, not a hard cutoff (e.g. 20% A2, 65% B1, 15% B2)
- A confidence interval is shown to the user ("estimated B1, ± half a level")

---

## CEFR → Exam Mapping

### IELTS (English)
| CEFR | IELTS Overall Band |
|---|---|
| A2 | 3.0–4.0 |
| B1 | 4.5–5.5 |
| B2 | 6.0–7.0 |
| C1 | 7.5–8.5 |
| C2 | 9.0 |

Per-skill bands map our Listening/Reading/Writing/Speaking estimates directly to IELTS sub-bands.

**IELTS-specific grading criteria we can replicate:**
- Writing Task 2: Task Response, Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy
- Speaking: Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy, Pronunciation

### DELE (Spanish)
| CEFR | Exam |
|---|---|
| A1 | DELE A1 |
| A2 | DELE A2 |
| B1 | DELE B1 |
| B2 | DELE B2 |
| C1 | DELE C1 |
| C2 | DELE C2 |

DELE is pass/fail at a chosen level. We predict: *"Based on your current profile, you would likely pass DELE B1. Your weakest sub-area is Expresión Oral (Speaking). You'd need ~6 more weeks of focused speaking practice to reach a reliable pass."*

### Goethe-Zertifikat (German)
Same structure as DELE — one exam per CEFR level. Four sub-tests: Lesen, Hören, Schreiben, Sprechen. We map directly.

### YDS / YÖKDİL (Turkish, academic)
These are academic-oriented exams, heavily reading/vocabulary focused. Our reading comprehension and academic vocabulary tracking maps well. We flag "academic register" as a distinct track for Turkish.

---

## Progress Data Model

```sql
-- Granular grammar knowledge units
grammar_points (
  id, language, name, cefr_level, description, example
)

-- Skill competency definitions
competencies (
  id, skill_area,  -- listening/reading/writing/speaking/vocabulary/grammar
  name, cefr_level, language, description
)

-- Per-user mastery per grammar point
user_grammar_mastery (
  user_id, grammar_point_id,
  mastery_score FLOAT,      -- 0.0–1.0
  confidence FLOAT,          -- 0.0–1.0
  evidence_count INT,
  last_practiced_at TIMESTAMP,
  last_updated_at TIMESTAMP
)

-- Per-user mastery per competency
user_competency_mastery (
  user_id, competency_id,
  mastery_score FLOAT,
  confidence FLOAT,
  evidence_count INT,
  last_updated_at TIMESTAMP
)

-- Per-user vocabulary mastery
user_vocabulary (
  user_id, word_id, language,
  passive_score FLOAT,   -- recognition
  active_score FLOAT,    -- production / recall
  frequency_rank INT,    -- position in frequency list
  last_reviewed_at TIMESTAMP,
  next_review_at TIMESTAMP  -- spaced repetition schedule
)

-- Rolling CEFR estimate (recalculated periodically or after sessions)
user_cefr_estimates (
  user_id, language, skill_area,
  estimated_level VARCHAR,     -- 'B1', 'B2', etc.
  confidence FLOAT,
  level_distribution JSONB,    -- {"A2": 0.1, "B1": 0.7, "B2": 0.2}
  calculated_at TIMESTAMP
)

-- Exam readiness snapshots
user_exam_readiness (
  user_id, language, exam_type,   -- 'IELTS', 'DELE_B2', 'GOETHE_B1', etc.
  readiness_score FLOAT,
  predicted_result VARCHAR,       -- 'likely pass', 'borderline', 'not ready'
  weak_areas JSONB,
  calculated_at TIMESTAMP
)
```

---

## What the User Sees

### 1. Language overview card
```
Spanish — Estimated B1  (↑ from A2 · 3 months ago)
━━━━━━━━━━━━━━━━━━━━━━━━░░░░░░░░░░  62% toward B2

Listening  ████████░░  B1   Reading   ██████████  B2
Speaking   ████░░░░░░  A2   Writing   ███████░░░  B1
```

### 2. Skill radar chart
A spider/radar chart with 6 axes: Listening, Reading, Writing, Speaking, Vocabulary, Grammar. Each axis shows the CEFR level as a 0–100 score. Immediately shows imbalances (e.g. strong reader, weak speaker).

### 3. Grammar mastery map
A grid of grammar points organized by level (A1 → C2). Color-coded:
- Green (>80%): mastered
- Yellow (40–80%): in progress / growth zone
- Red (<40%): not started or weak
- Grey: not yet attempted

This is the most actionable view — it shows exactly which grammar rules to practice next.

### 4. Vocabulary coverage
- "You know ~2,400 of the top 5,000 Spanish words actively"
- Progress bar per frequency band (top 1K, 1K–3K, 3K–10K)
- Domain breakdown (everyday 78%, academic 31%, business 44%)

### 5. Exam readiness panel (opt-in)
```
IELTS Readiness (English)
  Overall:   ~6.5  (target: 7.0)
  Listening: 7.0  ✓
  Reading:   7.0  ✓
  Writing:   6.0  ← focus here
  Speaking:  6.0  ← focus here

DELE B2 (Spanish)
  Readiness: 71%  —  borderline
  Weakest:   Expresión Oral
```

### 6. Growth zone feed
Rather than picking exercises manually, the "what should I practice" view surfaces:
- Grammar points in the 40–70% mastery range
- Vocabulary in the next frequency band above current coverage
- The weakest macro-skill relative to the strongest
- Items due for spaced repetition review

---

## Key Design Decisions

**Evidence-based, not time-based.** A user who does 10 hard exercises correctly earns a higher mastery signal than one who completes 50 easy ones. Lesson count is irrelevant.

**Confidence-gated CEFR claims.** We don't show a user "you're B2" with only 3 data points. The UI reflects uncertainty — "estimated B1, based on 47 exercises" vs "estimated B1, based on 6 exercises."

**Skill imbalance is a feature.** Most learners are uneven (strong reader, weak speaker). The app celebrates this as useful signal rather than hiding it behind a single overall score.

**Exam readiness is derived, not primary.** We don't build toward the exam; we build genuine competency and surface exam readiness as a byproduct. This avoids the Goodhart's Law trap (teaching to the test).

**No streaks, no XP.** The progress dashboard is the motivational engine — watching your grammar map turn greener and your CEFR estimate inch upward is the reward.
