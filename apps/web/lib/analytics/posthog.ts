import posthog from 'posthog-js';

let ready = false;

function key(): string {
  return process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '';
}

/** Idempotent. Inits PostHog once if a key exists. No-op otherwise. */
export function initAnalytics(): void {
  if (ready || !key() || typeof window === 'undefined') return;
  posthog.init(key(), {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? '/ingest',
    ui_host: 'https://eu.posthog.com',
    capture_pageview: false, // App Router: captured manually in use-pageviews
    autocapture: true,
    opt_out_capturing_by_default: true, // belt-and-suspenders; opt-in happens on consent
    disable_session_recording: true, // recording started explicitly in optInAnalytics()
    persistence: 'localStorage+cookie',
    session_recording: { maskAllInputs: true, maskTextSelector: '*' },
  });
  ready = true;
}

export function isReady(): boolean {
  return ready;
}

export function optInAnalytics(): void {
  if (!ready) return;
  posthog.opt_in_capturing();
  posthog.startSessionRecording();
}

export function optOutAnalytics(): void {
  if (!ready) return;
  posthog.opt_out_capturing();
  posthog.stopSessionRecording();
}

export function captureEvent(event: string, props?: Record<string, unknown>): void {
  if (!ready) return;
  posthog.capture(event, props);
}

export function identifyUser(distinctId: string): void {
  if (!ready) return;
  posthog.identify(distinctId);
}

export function resetUser(): void {
  if (!ready) return;
  posthog.reset();
}
