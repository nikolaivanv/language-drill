/**
 * packages/ai — Claude API client wrapper and prompt template registry.
 * Phase 0 stub: structure established so Phase 1 can add evaluation prompts
 * without touching Lambda code.
 */

export type PromptTemplate = {
  name: string;
  system: string;
  user: string;
};

/**
 * Creates a Claude API client stub.
 * Implementation deferred to Phase 1 — returns the apiKey for now so the
 * type contract is established and importable from other packages.
 */
export function createClaudeClient(apiKey: string): { apiKey: string } {
  return { apiKey };
}
