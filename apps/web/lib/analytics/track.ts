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
  | 'consent_updated'
  // Signed-out public surfaces (/try/forms, language landings, grammar pages).
  // `surface` says which one; see PublicSurface below.
  | 'public_item_answered'
  | 'public_set_completed'
  | 'signup_cta_clicked';

/** Which signed-out surface a public_* / signup_cta_clicked event came from. */
export type PublicSurface =
  | 'try_forms' // the /try/forms drill
  | 'landing_hero' // the one-item try block on /spanish, /german, /turkish
  | 'landing_footer' // the "Create an account" CTA at the foot of a landing page
  | 'quick_check' // the quick check at the end of a public grammar page
  | 'grammar_rail' // the practise rail beside a public grammar page
  | 'try_forms_debrief' // the sign-up link on the /try/forms debrief
  | 'public_header'; // the quiet sign-up link in the public header

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
