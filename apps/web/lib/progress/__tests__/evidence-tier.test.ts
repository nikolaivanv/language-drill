import { describe, it, expect } from 'vitest';
import { evidenceTier, THIN_EVIDENCE_THRESHOLD } from '../evidence-tier';

describe('evidenceTier', () => {
  it('classifies zero evidence as untrained', () => {
    expect(evidenceTier(0)).toBe('untrained');
  });

  it('classifies 1..(threshold-1) as thin', () => {
    expect(evidenceTier(1)).toBe('thin');
    expect(evidenceTier(THIN_EVIDENCE_THRESHOLD - 1)).toBe('thin');
  });

  it('classifies >= threshold as robust', () => {
    expect(evidenceTier(THIN_EVIDENCE_THRESHOLD)).toBe('robust');
    expect(evidenceTier(50)).toBe('robust');
  });

  it('treats negative as untrained (defensive)', () => {
    expect(evidenceTier(-1)).toBe('untrained');
  });
});
