/**
 * Zod envelopes for the theory API's list-style responses.
 *
 * The single-topic endpoint (`GET /theory/:lang/:topicId`) does NOT have a
 * Zod schema here. Its body is the `TheoryTopicJson` taxonomy already parsed
 * by `parseTheoryTopicJson` in `@language-drill/shared`. Both server and
 * client call that hand-written parser instead of defining a second schema,
 * keeping one source-of-truth for the topic body (design refinement of
 * requirements doc Req 2).
 */
import { z } from 'zod';

// Envelope for GET /theory/:lang
//
// `category` + `order` are server-side enrichment fields (a topic's theory
// category resolved from its grammar-point key, and its 0-based curriculum
// position). They carry `.default()`s so the schema still parses legacy
// payloads from a server that predates the enrichment — additive contract,
// per design §"Component 4". `order` is null when the topic has no resolvable
// curriculum position; the library sorts such topics last.
export const TheoryListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  cefr: z.string(),
  category: z.string().default('other'),
  order: z.number().nullable().default(null),
});

export const TheoryListResponseSchema = z.object({
  topics: z.array(TheoryListItemSchema),
});

export type TheoryListItem = z.infer<typeof TheoryListItemSchema>;
export type TheoryListResponse = z.infer<typeof TheoryListResponseSchema>;

// Envelope for GET /admin/theory/coverage
export const TheoryCoverageRowSchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']),
  level: z.enum(['A1', 'A2', 'B1', 'B2']),
  approved: z.number().int().nonnegative(),
  flagged: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const TheoryCoverageResponseSchema = z.object({
  rows: z.array(TheoryCoverageRowSchema),
});

export type TheoryCoverageRow = z.infer<typeof TheoryCoverageRowSchema>;
export type TheoryCoverageResponse = z.infer<typeof TheoryCoverageResponseSchema>;

// Envelope item for GET /admin/theory/pool-status (one per grammar curriculum point).
export const PoolStatusTheoryItemSchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']),
  level: z.enum(['A1', 'A2', 'B1', 'B2']),
  grammarPointKey: z.string(),
  name: z.string(),
  hasApprovedPage: z.boolean(),
  flaggedCount: z.number().int().nonnegative(),
  lastGeneratedAt: z.string().nullable(),
});

export type PoolStatusTheoryItem = z.infer<typeof PoolStatusTheoryItemSchema>;

// ---------------------------------------------------------------------------
// Related-topics enrichment on GET /theory/:lang/:topicId. The server derives
// this per-request from curriculum data (prereq edges + theory category) and
// spreads it NEXT TO the TheoryTopicJson body — it is not part of the stored
// content contract, so it gets its own schema here rather than a field in
// `parseTheoryTopicJson`.
// ---------------------------------------------------------------------------

export const RelatedTopicRefSchema = z.object({
  topicId: z.string(),
  title: z.string(),
  cefr: z.string(),
});

export const RelatedTheoryTopicsSchema = z.object({
  buildsOn: z.array(RelatedTopicRefSchema),
  leadsTo: z.array(RelatedTopicRefSchema),
  siblings: z.array(RelatedTopicRefSchema),
});

export type RelatedTopicRef = z.infer<typeof RelatedTopicRefSchema>;
export type RelatedTheoryTopics = z.infer<typeof RelatedTheoryTopicsSchema>;

/**
 * Lenient extractor: pulls `related` off a raw single-topic response body.
 * Returns null when the field is missing (server predates the enrichment) or
 * malformed — related links are an enhancement and must never block the topic
 * from rendering.
 */
export function parseRelatedTheoryTopics(input: unknown): RelatedTheoryTopics | null {
  if (typeof input !== 'object' || input === null || !('related' in input)) return null;
  const result = RelatedTheoryTopicsSchema.safeParse(
    (input as { related: unknown }).related,
  );
  return result.success ? result.data : null;
}
