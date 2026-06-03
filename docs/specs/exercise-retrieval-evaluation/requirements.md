# Requirements Document — Exercise Retrieval & Evaluation

## Introduction

This feature implements the core exercise loop: retrieving exercises from the pre-generated pool and evaluating user answers via Claude AI. It is the first vertical slice that lets a user actually practice — selecting an exercise by language and difficulty, submitting a free-form answer, and receiving structured AI feedback with scores mapped to the progress-tracking model.

## Alignment with Product Vision

This feature directly delivers the app's primary differentiator: **forcing written production** and evaluating it with AI, not multiple-choice recognition. It connects to:

- **Active production practice** — users write answers, not pick from options
- **Skill-based mastery tracking** — Claude returns structured scores per dimension that feed the mastery model
- **CEFR spine** — exercises are tagged by CEFR level; evaluations produce CEFR evidence
- **Pre-generated content pool** — exercises are retrieved from the database (pre-seeded), keeping AI costs limited to evaluation only

## Requirements

### Requirement 1 — Exercise Retrieval

**User Story:** As a learner, I want to receive an exercise matching my target language and difficulty level, so that I can practice at the right challenge level.

#### Acceptance Criteria

1. WHEN a user requests an exercise with a `language` and `difficulty` (CEFR level) THEN the system SHALL return a random exercise from the pool matching those filters.
2. WHEN a user requests an exercise with an optional `type` filter (cloze, translation, vocab_recall) THEN the system SHALL filter exercises by that type as well.
3. IF no exercises match the requested filters THEN the system SHALL return a 404 response with a clear error message.
4. WHEN an exercise is returned THEN the response SHALL include the exercise `id`, `type`, `language`, `difficulty`, and parsed `contentJson` body.
5. WHEN a user is not authenticated THEN the system SHALL return a 401 response.

### Requirement 2 — Exercise Content Structure

**User Story:** As a learner, I want exercises to have a clear, consistent structure, so that the UI can render any exercise type predictably.

#### Acceptance Criteria

1. WHEN a cloze exercise is returned THEN `contentJson` SHALL contain `sentence` (with blank marker), `options` (array, optional for open cloze), `correctAnswer`, and `context` (optional hint).
2. WHEN a translation exercise is returned THEN `contentJson` SHALL contain `sourceText`, `sourceLanguage`, `targetLanguage`, and `referenceTranslation`.
3. WHEN a vocab_recall exercise is returned THEN `contentJson` SHALL contain `prompt`, `expectedWord`, `hints` (array), and `exampleSentence`.
4. ALL exercise types SHALL include an `instructions` field with user-facing directions.

### Requirement 3 — Answer Submission & AI Evaluation

**User Story:** As a learner, I want to submit my answer and receive detailed AI feedback, so that I understand what I got right and where to improve.

#### Acceptance Criteria

1. WHEN a user submits an answer for an exercise THEN the system SHALL send the exercise content and user answer to Claude for evaluation.
2. WHEN Claude returns an evaluation THEN the response SHALL include: `score` (0.0–1.0), `grammarAccuracy` (0.0–1.0), `vocabularyRange` (CEFR level string), `taskAchievement` (0.0–1.0), `feedback` (natural language explanation), and `errors` (array of specific errors with type, severity, and correction).
3. WHEN the evaluation is complete THEN the system SHALL persist the result in `user_exercise_history` with the user's answer and Claude's evaluation as `responseJson`.
4. WHEN the evaluation is complete THEN the system SHALL return the full evaluation to the user.
5. IF Claude API call fails THEN the system SHALL return a 502 response with an appropriate error message and NOT persist a history record.
6. WHEN a user submits an answer THEN the system SHALL log a `usageEvent` of type `ai_evaluation` for rate-limiting tracking.
7. IF a user has exceeded their daily AI evaluation limit THEN the system SHALL return a 429 response with a message indicating when the limit resets.

### Requirement 4 — Exercise Seeding

**User Story:** As a developer, I want a seed script that populates the exercise pool with sample exercises, so that the retrieval and evaluation flow can be tested end-to-end.

#### Acceptance Criteria

1. WHEN the seed script runs THEN it SHALL insert at least 3 exercises per type (cloze, translation, vocab_recall) for each supported language (EN, ES, DE, TR).
2. WHEN the seed script runs THEN each exercise SHALL have valid `contentJson` matching the schema for its type.
3. WHEN the seed script runs against an already-seeded database THEN it SHALL be idempotent (no duplicate exercises).

### Requirement 5 — Exercise UI (Web)

**User Story:** As a learner, I want a web page where I can practice exercises, see the prompt, type my answer, and view AI feedback.

#### Acceptance Criteria

1. WHEN a user navigates to the practice page THEN the system SHALL fetch and display an exercise based on the user's selected language and difficulty.
2. WHEN an exercise is displayed THEN the UI SHALL show the exercise instructions, prompt content, and an input area appropriate to the exercise type.
3. WHEN the user submits their answer THEN the UI SHALL show a loading state during evaluation.
4. WHEN the evaluation returns THEN the UI SHALL display the score, feedback text, and specific errors with corrections highlighted.
5. WHEN the evaluation is displayed THEN the user SHALL be able to request the next exercise without navigating away.
6. IF an API error occurs THEN the UI SHALL display a user-friendly error message.

### Requirement 6 — API Client Hooks

**User Story:** As a frontend developer, I want typed React Query hooks for exercise endpoints, so that the web app can fetch and submit exercises with proper caching and error handling.

#### Acceptance Criteria

1. WHEN the `useExercise` hook is called with language and difficulty THEN it SHALL fetch an exercise from the API and return typed data.
2. WHEN the `useSubmitAnswer` mutation is called THEN it SHALL post the answer to the API and return the typed evaluation result.
3. ALL API response schemas SHALL be validated with Zod before being returned to components.

## Non-Functional Requirements

### Performance
- Exercise retrieval SHALL respond within 200ms (database query only)
- Answer evaluation SHALL respond within 10 seconds (Claude API latency budget)
- The UI SHALL show a loading indicator immediately upon answer submission
- Claude API calls SHALL use Anthropic prompt caching for system prompts to reduce cost (~80% token savings within a session)

### Security
- All exercise and submission endpoints SHALL require authentication via the existing Clerk JWT authorizer
- User answers and evaluations SHALL only be accessible to the user who created them
- The Claude API key SHALL remain server-side only (Lambda environment variable)

### Reliability
- Claude API failures SHALL NOT cause data corruption — no partial writes to history
- The exercise pool SHALL be queryable even when Claude API is unavailable (retrieval is independent of AI)

### Usability
- Error messages SHALL be user-friendly (no raw error codes or stack traces)
- The exercise UI SHALL work on both desktop and mobile viewport widths
- The evaluation feedback SHALL use the target language's script and characters correctly (Turkish İ/ı, German ü/ö/ä/ß, Spanish ñ/¿/¡)

## Out of Scope (deferred to later specs)

- Exercise history viewing / past evaluation browsing
- Spaced repetition scheduling updates (SM-2 card creation/update after evaluation)
- Progress model updates (Bayesian mastery scores, CEFR estimation)
- Pre-generation Lambda (exercises will be seeded manually for now)
- Audio exercises (listening/speaking — Phase 2)
- Rate-limit counter implementation in Upstash Redis (this spec logs usage events; the counter/enforcement layer is a separate concern)
