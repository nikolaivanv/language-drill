import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./posthog', () => ({ captureEvent: vi.fn() }));
import { captureEvent } from './posthog';
import { track } from './track';

describe('track()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards event name and props to captureEvent', () => {
    track('drill_started', { language: 'tr', cefr: 'B1' });
    expect(captureEvent).toHaveBeenCalledWith('drill_started', { language: 'tr', cefr: 'B1' });
  });

  it('works with no props', () => {
    track('debrief_viewed');
    expect(captureEvent).toHaveBeenCalledWith('debrief_viewed', undefined);
  });
});
