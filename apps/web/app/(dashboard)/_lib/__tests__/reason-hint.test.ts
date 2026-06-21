import { describe, it, expect } from 'vitest';
import { reasonHint } from '../reason-hint';

describe('reasonHint', () => {
  it('maps each reason to its quiet hint', () => {
    expect(reasonHint('new')).toBe('new point');
    expect(reasonHint('reinforce')).toBe('reinforcing');
    expect(reasonHint('review')).toBe('due for review');
    expect(reasonHint('error-fix')).toBe('recent error spot');
  });

  it('returns null for a null reason', () => {
    expect(reasonHint(null)).toBeNull();
  });
});
