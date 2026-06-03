# Profile Onboarding — Requirements

## Overview

Language profile setup and onboarding flow for new users. After signing up via Clerk, users must select which languages they're learning and self-assess their current CEFR level before accessing the app. This data drives exercise selection, progress tracking, and the entire downstream experience.

## Problem Statement

Currently, the practice page defaults every user to English/B1 with no persistence. Users must manually re-select language and difficulty each session. There's no mechanism to know which languages a user is learning or at what level — blocking progress tracking, spaced repetition, and personalized exercise queues.

## User Stories

### US-1: Language Selection
**As a** new user who just signed up,
**I want to** select which languages I'm learning,
**so that** the app shows me relevant exercises without asking every time.

### US-2: Proficiency Self-Assessment
**As a** new user setting up my profile,
**I want to** indicate my approximate CEFR level for each language,
**so that** exercises match my ability from the first session.

### US-3: Multi-Language Support
**As a** polyglot learner,
**I want to** add multiple languages at different levels (e.g., Spanish B2, Turkish A1),
**so that** I can practice all my target languages in one app.

### US-4: Onboarding Gate
**As a** product owner,
**I want** new users to complete language setup before accessing practice,
**so that** no user reaches the practice page without profile data.

### US-5: Profile Editing
**As a** returning user,
**I want to** add/remove languages or adjust my self-assessed level later,
**so that** my profile stays accurate as I progress.

### US-6: Practice Page Integration
**As a** user with a configured profile,
**I want** the practice page to default to my language(s) and level(s),
**so that** I can start practicing immediately without manual selection.

## Functional Requirements

### FR-1: Onboarding Flow
- **FR-1.1**: WHEN a user completes signup and has zero language profiles, THEN the app SHALL redirect them to the onboarding page.
- **FR-1.2**: The onboarding page SHALL allow selecting one or more languages from the supported set (EN, ES, DE, TR).
- **FR-1.3**: For each selected language, the user SHALL choose a self-assessed CEFR level (A1–C2).
- **FR-1.4**: The onboarding page SHALL display brief, plain-language descriptions of each CEFR level to help users self-assess accurately.
- **FR-1.5**: The user SHALL select at least one language before completing onboarding.
- **FR-1.6**: WHEN the user completes onboarding, THEN they SHALL be redirected to the dashboard home page.

### FR-2: Profile API
- **FR-2.1**: The API SHALL expose `GET /profiles/languages` to retrieve the current user's language profiles.
- **FR-2.2**: The API SHALL expose `PUT /profiles/languages` to create or update the user's full set of language profiles (idempotent replace).
- **FR-2.3**: All profile endpoints SHALL require authentication.
- **FR-2.4**: The API SHALL validate that languages are from the supported enum and levels are valid CEFR values.
- **FR-2.5**: The API SHALL return 400 with a descriptive error if the request contains invalid data.

### FR-3: Onboarding Gate
- **FR-3.1**: WHEN an authenticated user with zero language profiles navigates to any dashboard page, THEN the app SHALL redirect them to `/onboarding`.
- **FR-3.2**: WHEN an authenticated user with one or more language profiles navigates to `/onboarding`, THEN they SHALL still be able to access it (for profile editing).
- **FR-3.3**: The onboarding page SHALL be a protected route (requires Clerk auth).

### FR-4: Practice Page Integration
- **FR-4.1**: WHEN the practice page loads, IF the user has language profiles, THEN the language selector SHALL default to the user's first language profile.
- **FR-4.2**: WHEN the practice page loads, IF the user has language profiles, THEN the difficulty selector SHALL default to the user's self-assessed level for the selected language.
- **FR-4.3**: The practice page language selector SHALL only show languages the user has in their profile, plus an "Add language" option that navigates to `/onboarding`.

### FR-5: Error Handling & Edge Cases
- **FR-5.1**: WHEN a profile save fails due to a network or server error, THEN the onboarding page SHALL display an error message and allow the user to retry without losing their selections.
- **FR-5.2**: WHEN a user removes a language from their profile via `PUT /profiles/languages`, THEN their exercise history for that language SHALL be preserved (not deleted).
- **FR-5.3**: WHEN an existing user (created before this feature) logs in and has zero language profiles, THEN they SHALL be redirected to onboarding the same as a new user.

## Non-Functional Requirements

### NFR-1: Performance
- Profile data SHALL load in under 200ms from the API.
- The onboarding page SHALL render without layout shift after initial load.

### NFR-2: Data Integrity
- Language profile updates SHALL be atomic — either all profiles save or none do (transaction).
- Duplicate language entries for the same user SHALL be prevented at the database level.

### NFR-3: UX
- The onboarding flow SHALL be completable in under 60 seconds.
- CEFR level descriptions SHALL use plain language (no jargon like "Can understand the main ideas of complex text on both concrete and abstract topics").

## Out of Scope

- AI-powered level assessment (Phase 3 — this is self-assessment only)
- Native language / interface language selection
- Learning goals or interests (Phase 3 personalization)
- Notification preferences
- Account deletion or data export

## Dependencies

- Clerk authentication (exists)
- `userLanguageProfiles` table (exists in schema, needs unique constraint)
- `Language` and `CefrLevel` enums from `@language-drill/shared` (exist)

## Acceptance Criteria Summary

| ID | Criterion |
|----|-----------|
| AC-1 | New user with no profiles is redirected to `/onboarding` from any dashboard route |
| AC-2 | User can select 1–4 languages with CEFR levels and save successfully |
| AC-3 | After completing onboarding, user lands on dashboard home |
| AC-4 | Practice page defaults to user's first language profile |
| AC-5 | `GET /profiles/languages` returns the user's saved profiles |
| AC-6 | `PUT /profiles/languages` replaces profiles atomically |
| AC-7 | User can return to onboarding later to edit their profile |
| AC-8 | Invalid API requests return 400 with descriptive errors |
| AC-9 | WHEN profile save fails, error is shown and user can retry without losing selections |
| AC-10 | Existing users with no profiles are redirected to onboarding on next login |
| AC-11 | Removing a language from profile does not delete exercise history for that language |
