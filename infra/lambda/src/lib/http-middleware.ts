import type { Context, Next } from 'hono';
import { FALLBACK_ORIGINS } from '@language-drill/shared';
import { flushObservability } from '@language-drill/ai';

// Shared by every Hono-based Lambda entry point: the API Gateway handler
// (`index.ts`) and the long-running eval-submit Function URL
// (`eval-submit/handler.ts`), so both answer CORS for exactly the same origins.

const parsedAllowedOrigins = (process.env['ALLOWED_ORIGINS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOriginPatterns =
  parsedAllowedOrigins.length > 0 ? parsedAllowedOrigins : FALLBACK_ORIGINS;

export function matchOrigin(origin: string): string | null {
  for (const pattern of allowedOriginPatterns) {
    if (pattern === origin) return origin;
    const wildcardMatch = pattern.match(/^(https?:\/\/)\*\.(.+)$/);
    if (wildcardMatch) {
      const [, scheme, suffix] = wildcardMatch;
      const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^${scheme}([^/]+\\.)?${escapedSuffix}$`);
      if (re.test(origin)) return origin;
    }
  }
  return null;
}

/**
 * Drain buffered Langfuse traces after every request so the Lambda's next
 * freeze doesn't drop them. `flushObservability` is a no-op when Langfuse
 * is disabled, and races flushAsync against a 200ms hard cap so a slow
 * sink can never delay the response (Req 6 AC 1 + AC 5).
 *
 * Exported for direct unit testing — middlewares are easier to verify as
 * pure functions than via app.request roundtrips.
 */
export async function flushMiddleware(_c: Context, next: Next): Promise<void> {
  try {
    await next();
  } finally {
    await flushObservability();
  }
}
