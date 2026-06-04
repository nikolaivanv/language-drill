// Single source of truth for per-bucket daily AI usage limits. The three AI
// endpoints (answer evaluation, skim annotation, deep-span annotation) each
// meter a SEPARATE bucket; a boosted plan raises every bucket by BOOST_MULTIPLIER.

export type MeteredEventType =
  | 'ai_evaluation'
  | 'read_annotation'
  | 'read_span_annotation';

export type Plan = 'free' | 'boosted';

export const BASE_DAILY_LIMITS: Record<MeteredEventType, number> = {
  ai_evaluation: 50,
  read_annotation: 50,
  read_span_annotation: 150,
};

export const BOOST_MULTIPLIER = 10;

export function limitFor(eventType: MeteredEventType, plan: Plan): number {
  const base = BASE_DAILY_LIMITS[eventType];
  return plan === 'boosted' ? base * BOOST_MULTIPLIER : base;
}
