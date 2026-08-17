import type { QueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Progress-derived query cache
// ---------------------------------------------------------------------------
// Every query below is computed server-side from the learner's exercise
// history / mastery state, so answering an exercise or finishing a session
// invalidates all of them at once. They each carry a multi-minute `staleTime`
// (the screens are read-heavy and re-mount constantly), which means a
// client-side navigation into `/progress` or `/home` right after a drill would
// otherwise re-render the PRE-drill snapshot — the numbers only corrected
// themselves on a hard refresh, which builds a fresh QueryClient.
//
// Keys are listed as PREFIXES: the live keys are language- (or point-) scoped
// (`['progressRadar', 'ES']`), and TanStack Query matches prefixes, so one
// entry covers every language the learner has cached.
// ---------------------------------------------------------------------------

export const PROGRESS_DERIVED_QUERY_KEY_PREFIXES: readonly (readonly string[])[] = [
  ['progressRadar'], // GET /progress/radar     — Shape tab + dashboard snapshot
  ['curriculumMap'], // GET /progress/curriculum — Map tab + path cue
  ['errorTrends'], // GET /insights/error-trends — History tab
  ['insightsErrors'], // GET /insights/errors    — "work on these" themes
  ['fluencyStats'], // GET /fluency/stats        — Fluency tab
  ['todayPlan'], // GET /sessions/today          — dashboard timeline
  ['vocab', 'topics'], // GET /vocab/topics      — Words tab
  ['progress', 'point'], // GET /progress/points/:key — theory "drill this point"
];

/**
 * Invalidates every progress-derived query.
 *
 * `refetchType: 'none'` marks the caches stale without firing a request — the
 * right choice mid-session, where the screens holding this data are not
 * mounted and refetching per answer would be pure network churn. They refetch
 * on their next mount because `refetchOnMount` re-fetches stale queries.
 * Pass `'active'` at a boundary the learner is navigating away from (session
 * complete) so anything already on screen updates in place.
 */
export function invalidateProgressDerivedQueries(
  queryClient: QueryClient,
  refetchType: 'active' | 'none' = 'active',
): void {
  for (const prefix of PROGRESS_DERIVED_QUERY_KEY_PREFIXES) {
    void queryClient.invalidateQueries({ queryKey: [...prefix], refetchType });
  }
}
