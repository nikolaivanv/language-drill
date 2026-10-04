export type PublicLanguage = "ES" | "DE" | "TR";
export type PublicLevel = "A1" | "A2" | "B1" | "B2";

/**
 * Levels the public conjugation pool actually has approved content for, per
 * language. Prod measurement at branch-time found ZERO approved conjugation
 * rows for ES/DE at B2 — offering it in a picker one click from the default
 * would land a first-time, no-context visitor on an empty state. Single
 * source of truth for the page's level picker, its empty-state copy, and the
 * API's judgement of whether a theory topic can offer a drill at its own
 * level; update this when the pool gains B2 coverage for ES/DE.
 *
 * Lives in `shared` rather than `api-client` because the Lambda needs it too
 * and does not depend on `api-client`.
 */
export const PUBLIC_LEVELS_BY_LANGUAGE: Record<PublicLanguage, PublicLevel[]> = {
  ES: ["A1", "A2", "B1"],
  DE: ["A1", "A2", "B1"],
  TR: ["A1", "A2", "B1", "B2"],
};
