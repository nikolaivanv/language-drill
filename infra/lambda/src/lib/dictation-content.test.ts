import { describe, it, expect } from 'vitest';
import { withAudioUrl } from './dictation-content';

describe('withAudioUrl', () => {
  it('merges audioUrl into a dictation contentJson', () => {
    const out = withAudioUrl({ type: 'dictation', referenceText: 'x' }, 'https://signed');
    expect(out).toMatchObject({ type: 'dictation', referenceText: 'x', audioUrl: 'https://signed' });
  });

  it('returns content unchanged when url is null', () => {
    const content = { type: 'dictation', referenceText: 'x' };
    expect(withAudioUrl(content, null)).toBe(content);
  });

  it('passes through non-object content', () => {
    expect(withAudioUrl(null, 'https://x')).toBeNull();
  });
});
