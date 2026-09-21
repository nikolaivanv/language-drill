import { describe, it, expect, vi } from 'vitest';

import { createAuthExpiredHandler } from '../auth-expired';

describe('createAuthExpiredHandler', () => {
  it('sends the user to sign-in with the current URL so they return to it', () => {
    // The whole point of the redirect: a learner who opened
    // /drill?resume=<uuid> with a dead session must land back on that exact
    // URL after signing in, resuming the session they clicked into. Clerk's
    // client-side redirectToSignIn takes `redirectUrl` (the server-side helper
    // is the one that takes `returnBackUrl`), and the hosted sign-in page
    // honours it via the `redirect_url` query param.
    const redirectToSignIn = vi.fn();
    const handler = createAuthExpiredHandler({
      redirectToSignIn,
      currentUrl: () => 'https://www.langdrill.app/drill?resume=0a95f631',
    });

    handler();

    expect(redirectToSignIn).toHaveBeenCalledWith({
      redirectUrl: 'https://www.langdrill.app/drill?resume=0a95f631',
    });
  });

  it('redirects only once when several queries fail together', () => {
    // An expired session fails every in-flight query at once — the reported
    // incident produced four simultaneous errors. Without a latch that is four
    // competing navigations.
    const redirectToSignIn = vi.fn();
    const handler = createAuthExpiredHandler({
      redirectToSignIn,
      currentUrl: () => 'https://www.langdrill.app/drill?resume=0a95f631',
    });

    handler();
    handler();
    handler();

    expect(redirectToSignIn).toHaveBeenCalledTimes(1);
  });
});
