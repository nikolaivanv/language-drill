import { captureEvent } from './posthog';

export type AnalyticsEvent =
  | 'drill_started'
  | 'drill_completed'
  | 'exercise_submitted'
  | 'debrief_viewed'
  | 'curriculum_map_opened'
  | 'vocab_review_started'
  | 'theory_page_opened'
  | 'reading_annotation_used'
  | 'onboarding_step_completed'
  | 'consent_updated';

export type AnalyticsProps = {
  language?: string;
  cefr?: string;
  exerciseType?: string;
  [key: string]: unknown;
};

/**
 * Single, typed entry point for named product events. No-ops unless PostHog is
 * initialized (which requires analytics consent), so call sites need no guards.
 */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  captureEvent(event, props);
}
