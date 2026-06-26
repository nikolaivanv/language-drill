/**
 * Sentinel email seeded by the auth middleware (`middleware/auth.ts`) for a
 * brand-new user before the Clerk `user.created` webhook lands their real
 * address. It is intentionally NOT a deliverable address (the `placeholder`
 * domain has no TLD), so any email-sending path MUST guard against it — Resend
 * rejects it with "Invalid `to` field", which otherwise surfaces as a raw 500.
 *
 * Single source of truth: the auth middleware seeds it, the weekly-summary
 * dispatcher skips it, and the weekly-summary toggle route refuses to send to
 * it. Match with `isPlaceholderEmail` (suffix-based) rather than `===` so any
 * historical/variant placeholder shape is still caught.
 */
export const PLACEHOLDER_EMAIL = 'pending-webhook@placeholder';

const PLACEHOLDER_SUFFIX = '@placeholder';

/** True when `email` is the un-synced placeholder, not a deliverable address. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.endsWith(PLACEHOLDER_SUFFIX);
}
