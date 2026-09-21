export interface AuthExpiredHandlerOptions {
  /**
   * Clerk's client-side redirect. Note this takes `redirectUrl` — the
   * `returnBackUrl` spelling belongs to the *server-side* `auth()` helper, and
   * passing it here would be silently ignored, dropping the return URL.
   */
  redirectToSignIn: (opts: { redirectUrl: string }) => unknown;
  /** The URL to come back to, read lazily so it reflects the current page. */
  currentUrl: () => string;
}

/**
 * Builds the handler that answers an expired session by sending the user to
 * sign in and back again.
 *
 * Two details carry the behaviour:
 *
 *  - **Return URL.** The whole point is that someone who opened
 *    `/drill?resume=<uuid>` with a dead session lands back on that exact URL,
 *    resuming the session they clicked into rather than being dumped on
 *    `/home`. Clerk turns `redirectUrl` into the `redirect_url` query param the
 *    hosted sign-in page honours. (The in-app sign-in page's hardcoded
 *    `fallbackRedirectUrl="/home"` cannot hijack this: a fallback applies only
 *    when no `redirect_url` is present.)
 *
 *  - **The latch.** An expired session fails every in-flight query at once —
 *    the reported incident produced four simultaneous errors. Without this,
 *    that is four competing navigations.
 */
export function createAuthExpiredHandler({
  redirectToSignIn,
  currentUrl,
}: AuthExpiredHandlerOptions): () => void {
  let redirected = false;

  return () => {
    if (redirected) return;
    redirected = true;
    void redirectToSignIn({ redirectUrl: currentUrl() });
  };
}
