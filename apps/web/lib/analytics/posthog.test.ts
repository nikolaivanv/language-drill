import { describe, it, expect, vi, beforeEach } from 'vitest';

const posthog = {
  init: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
};
vi.mock('posthog-js', () => ({ default: posthog }));

async function load() {
  vi.resetModules();
  return import('./posthog');
}

describe('analytics/posthog wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', '/ingest');
  });

  it('initAnalytics inits once with masking + opt-out defaults', async () => {
    const m = await load();
    m.initAnalytics();
    m.initAnalytics();
    expect(posthog.init).toHaveBeenCalledTimes(1);
    const [key, opts] = posthog.init.mock.calls[0];
    expect(key).toBe('phc_test');
    expect(opts.api_host).toBe('/ingest');
    expect(opts.capture_pageview).toBe(false);
    expect(opts.opt_out_capturing_by_default).toBe(true);
    expect(opts.session_recording.maskAllInputs).toBe(true);
    expect(m.isReady()).toBe(true);
  });

  it('is inert when no key is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    const m = await load();
    m.initAnalytics();
    m.captureEvent('x');
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(m.isReady()).toBe(false);
  });

  it('opt-in/opt-out drive capturing + recording only when ready', async () => {
    const m = await load();
    m.optInAnalytics(); // not ready yet
    expect(posthog.opt_in_capturing).not.toHaveBeenCalled();
    m.initAnalytics();
    m.optInAnalytics();
    expect(posthog.opt_in_capturing).toHaveBeenCalledTimes(1);
    expect(posthog.startSessionRecording).toHaveBeenCalledTimes(1);
    m.optOutAnalytics();
    expect(posthog.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(posthog.stopSessionRecording).toHaveBeenCalledTimes(1);
  });

  it('capture/identify/reset forward only when ready', async () => {
    const m = await load();
    m.captureEvent('e', { a: 1 }); // not ready
    expect(posthog.capture).not.toHaveBeenCalled();
    m.initAnalytics();
    m.captureEvent('e', { a: 1 });
    m.identifyUser('user_1');
    m.resetUser();
    expect(posthog.capture).toHaveBeenCalledWith('e', { a: 1 });
    expect(posthog.identify).toHaveBeenCalledWith('user_1');
    expect(posthog.reset).toHaveBeenCalledTimes(1);
  });
});
