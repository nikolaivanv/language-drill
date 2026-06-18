/**
 * packages/ai — refusal signal for the answer-evaluation path.
 *
 * Claude can decline to act on a user answer for safety reasons. With forced
 * `tool_choice` this surfaces as a successful HTTP 200 whose `stop_reason` is
 * `"refusal"` and whose `content` carries no `tool_use` block — the same
 * "no tool block" shape as a malformed response, but a different *cause*.
 * Throwing this distinct type lets the route tell a content refusal (expected,
 * user-facing) apart from an infra failure (a 502 "AI unavailable"), so a
 * learner who pastes provocative text gets a clear rejection instead of what
 * looks like an outage.
 */
export class ContentRejectedError extends Error {
  constructor(
    message: string,
    /** The Anthropic `stop_reason` that triggered this (always `"refusal"` today). */
    readonly stopReason: string,
  ) {
    super(message);
    this.name = "ContentRejectedError";
  }
}
