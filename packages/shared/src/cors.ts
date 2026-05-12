/**
 * Shared CORS allow-list — single source of truth for the Lambda Hono CORS
 * middleware AND the streaming Lambda's Function URL CORS config. Both have
 * to accept exactly the same origins; duplicating the list in two places
 * (as it used to be) made drift trivially likely.
 *
 * Wildcards: `https://*.vercel.app` works for both AWS Lambda Function URL
 * CORS (`AllowOrigins` accepts wildcard subdomain patterns) and the in-app
 * Hono regex matcher in `infra/lambda/src/index.ts`.
 */
export const FALLBACK_ORIGINS = [
  "https://*.vercel.app",
  "https://langdrill.app",
  "https://www.langdrill.app",
] as const;
