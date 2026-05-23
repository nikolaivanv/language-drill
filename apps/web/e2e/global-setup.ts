// Playwright global setup. Runs once before any worker spawns.
//
// `clerkSetup()` fetches a dev-instance Testing Token and stores it on
// `process.env.CLERK_TESTING_TOKEN`, which Playwright workers inherit on
// spawn. Without this, `setupClerkTestingToken()` (called from the
// unauthenticated sign-in spec) throws because no project dependency
// chain reaches a clerkSetup call — only the `authenticated` chain does.

import { clerkSetup } from '@clerk/testing/playwright';

export default clerkSetup;
