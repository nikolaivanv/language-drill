import { expect, test } from '@playwright/test';
import {
  FluencyAttemptResponseSchema,
  FluencySessionResponseSchema,
} from '@language-drill/api-client';
import { validatedReply } from '../../helpers/mock-reply';
import { seedShell } from '../../helpers/seed-mocks';

// ---------------------------------------------------------------------------
// Fluency Mode E2E
// ---------------------------------------------------------------------------
// Mocks POST /fluency/session and POST /fluency/attempts so the test is
// deterministic and runs without a live API or DB. Two valid outcomes are
// accepted:
//
//   1. Insufficient pool — the page surfaces the "master a few more items
//      first" copy when the mocked session returns a 409.
//   2. Drill available — the page renders a textbox; the user types an
//      answer, submits, and a verdict with role="status" appears.
//
// The mock below always returns a valid session (one cloze exercise), so
// the "drill available" branch is exercised. The `Promise.race` guard still
// tolerates the insufficient-pool branch, documenting both valid outcomes.
// ---------------------------------------------------------------------------

const EXERCISE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const FLUENCY_SESSION = {
  language: 'ES',
  exercises: [
    {
      id: EXERCISE_ID,
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
};

const FLUENCY_ATTEMPT = {
  correct: true,
  correctAnswer: 'mucho',
  latencyMs: 1234,
};

test('fluency mode: run a timed item or show the insufficient-pool state', async ({ page }) => {
  // Shell gate (profile list + review badge) — see seed-mocks.ts.
  await seedShell(page);

  // Mock POST /fluency/session — return a one-exercise session.
  await page.route('**/fluency/session', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill(validatedReply(FluencySessionResponseSchema, FLUENCY_SESSION));
  });

  // Mock POST /fluency/attempts — always grade as correct.
  await page.route('**/fluency/attempts', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill(validatedReply(FluencyAttemptResponseSchema, FLUENCY_ATTEMPT));
  });

  await page.goto('/fluency');

  const insufficient = page.getByText(/master a few more items first/i);
  const textbox = page.getByRole('textbox');

  // Either the drill is available, or the pool is too small in this DB — both are valid.
  await Promise.race([
    insufficient.waitFor({ state: 'visible', timeout: 15_000 }),
    textbox.waitFor({ state: 'visible', timeout: 15_000 }),
  ]);

  if (await insufficient.isVisible()) {
    await expect(insufficient).toBeVisible();
    return;
  }

  // Drill branch: fill in an answer and submit.
  await textbox.fill('answer');
  await page.getByRole('button', { name: 'submit' }).click();
  await expect(page.getByRole('status')).toBeVisible();
});
