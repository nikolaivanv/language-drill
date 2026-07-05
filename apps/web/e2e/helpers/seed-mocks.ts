// Shared content seeds for E2E specs and the `shoot` harness.
//
// `seedShell` covers the two endpoints EVERY authenticated page gates on: the
// (dashboard) layout blocks render until `/profiles/languages` resolves, and the
// Review tab badge polls `/review/overview`. Per-screen seeds add the content a
// specific route needs to render non-empty. `seedAll` registers everything, so
// the harness can shoot any seeded route without per-call setup.
//
// Registration order = priority (Playwright runs the LAST-registered matching
// handler first), so a spec may call a seed here and then override a single
// route with its own `page.route(...)` to exercise a specific branch.

import type { Page } from '@playwright/test';
import {
  ExerciseSetResponseSchema,
  FluencyAttemptResponseSchema,
  FluencySessionResponseSchema,
  LanguageProfilesResponseSchema,
} from '@language-drill/api-client';

import { reply, validatedReply } from './mock-reply';

const READ_ENTRY_ID = '11111111-1111-1111-1111-111111111111';

/** The universal authenticated-shell gate: profile list + review badge. */
export async function seedShell(page: Page): Promise<void> {
  await page.route('**/profiles/languages', (route) =>
    route.fulfill(
      validatedReply(LanguageProfilesResponseSchema, {
        profiles: [{ language: 'ES', proficiencyLevel: 'B1' }],
      }),
    ),
  );
  await page.route('**/review/overview**', (route) =>
    route.fulfill(
      reply({
        breakdown: { due: 3, new: 5, leech: 1, total: 42, mix: {} },
        estimatedMinutes: 6,
        nextDueAt: null,
      }),
    ),
  );
}

/** Reader: a one-entry list + that entry, so the reader auto-opens with text. */
export async function seedRead(page: Page): Promise<void> {
  await page.route(/\/read\/entries(\?|$)/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill(
          reply({
            entries: [
              {
                id: READ_ENTRY_ID,
                title: 'Aldea',
                source: '',
                preview: 'La aldea está en la montaña.',
                flaggedCount: 1,
                savedCount: 0,
                pastedAt: '2026-05-25T00:00:00.000Z',
              },
            ],
          }),
        )
      : route.fallback(),
  );
  await page.route(`**/read/entries/${READ_ENTRY_ID}`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill(
          reply({
            id: READ_ENTRY_ID,
            language: 'ES',
            title: 'Aldea',
            source: '',
            text: 'La aldea está en la montaña.',
            flaggedWords: {
              aldea: { lemma: 'aldea', pos: 'noun', gloss: 'village', freq: 1, cefr: 'B2' },
            },
            bank: [],
            pastedAt: '2026-05-25T00:00:00.000Z',
          }),
        )
      : route.fallback(),
  );
}

/** Fluency: a one-cloze session + a correct attempt verdict. */
export async function seedFluency(page: Page): Promise<void> {
  await page.route('**/fluency/session', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill(
          validatedReply(FluencySessionResponseSchema, {
            language: 'ES',
            exercises: [
              {
                id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                type: 'cloze',
                language: 'ES',
                difficulty: 'A2',
                grammarPointKey: null,
                contentJson: {
                  type: 'cloze',
                  sentence: 'Ella habla _____ español.',
                  answer: 'mucho',
                  translation: 'She speaks a lot of Spanish.',
                  grammarPoints: [],
                },
              },
            ],
          }),
        )
      : route.fallback(),
  );
  await page.route('**/fluency/attempts', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill(
          validatedReply(FluencyAttemptResponseSchema, {
            correct: true,
            correctAnswer: 'mucho',
            latencyMs: 1234,
          }),
        )
      : route.fallback(),
  );
}

/** Conjugation warm-up: a one-item set with a long + a short feature chip
 *  (the mobile chip-packing worst case). */
export async function seedConjugation(page: Page): Promise<void> {
  await page.route('**/exercises/set**', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill(
          validatedReply(ExerciseSetResponseSchema, {
            exercises: [
              {
                id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
                type: 'conjugation',
                language: 'TR',
                difficulty: 'A1',
                grammarPointKey: 'tr-a1-present-continuous',
                contentJson: {
                  type: 'conjugation',
                  instructions: 'Write the correct form.',
                  lemma: 'saymak',
                  lemmaGloss: 'to count',
                  featureBundle: 'şimdiki zaman · olumsuz · 2. tekil şahıs (sen)',
                  features: [
                    { term: 'şimdiki zaman', gloss: 'present continuous' },
                    { term: 'olumsuz', gloss: 'negative' },
                  ],
                  subject: { pronoun: 'sen', gloss: 'you (sg.)' },
                  targetForm: 'saymıyorsun',
                  breakdown: 'say- + -mıyor + -sun',
                  exampleSentences: ['Sen paraları saymıyorsun.'],
                },
              },
            ],
            available: 1,
          }),
        )
      : route.fallback(),
  );
}

/** Everything: the shell plus every per-screen seed. Used by the harness. */
export async function seedAll(page: Page): Promise<void> {
  await seedShell(page);
  await seedRead(page);
  await seedFluency(page);
  await seedConjugation(page);
}
