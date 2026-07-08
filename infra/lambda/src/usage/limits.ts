// Single source of truth for per-bucket daily AI usage limits. The three AI
// endpoints (answer evaluation, skim annotation, deep-span annotation) each
// meter a SEPARATE bucket; a boosted plan raises every bucket by BOOST_MULTIPLIER.

export type MeteredEventType =
  | 'ai_evaluation'
  | 'read_annotation'
  | 'read_span_annotation'
  | 'read_tts'
  | 'text_generation'
  | 'writing_helper';

export type Plan = 'free' | 'boosted';

export const BASE_DAILY_LIMITS: Record<MeteredEventType, number> = {
  ai_evaluation: 50,
  read_annotation: 50,
  read_span_annotation: 150,
  read_tts: 50,
  text_generation: 20,
  writing_helper: 50,
};

export const BOOST_MULTIPLIER = 10;

export function limitFor(eventType: MeteredEventType, plan: Plan): number {
  const base = BASE_DAILY_LIMITS[eventType];
  return plan === 'boosted' ? base * BOOST_MULTIPLIER : base;
}
