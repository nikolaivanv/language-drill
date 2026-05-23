import { expect, test } from '@playwright/test';

import { signInThroughUI } from '../../helpers/auth';
import { assertE2EEnv } from '../../helpers/env';

const env = assertE2EEnv();

test.skip(
  env.clerkPublishableKey.startsWith('pk_live_'),
  'UI sign-in test only runs against pk_test_ Clerk instances.',
);

test('signs in via Clerk-hosted UI', async ({ page }) => {
  await signInThroughUI(page);
  await expect(page).not.toHaveURL(/\/sign-in/);
  await expect(page).toHaveTitle(/Language Drill/i);
});
