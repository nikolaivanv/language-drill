import { describe, it, expect } from 'vitest';
import { CefrLevel } from '@language-drill/shared';
import { calibrationCopy } from './calibration-copy';

// ---------------------------------------------------------------------------
// calibrationCopy — one assertion per CEFR level + the null fallback case
// (Requirements 3.4, 6.2).
// ---------------------------------------------------------------------------

describe('calibrationCopy', () => {
  it('returns the A1 calibration tokens', () => {
    expect(calibrationCopy(CefrLevel.A1)).toEqual({
      eyebrow: '~A1+ calibration',
      explanation:
        'showing words rarer than top-750 · refined by your known set',
      topRank: 750,
    });
  });

  it('returns the A2 calibration tokens', () => {
    expect(calibrationCopy(CefrLevel.A2)).toEqual({
      eyebrow: '~A2+ calibration',
      explanation:
        'showing words rarer than top-1500 · refined by your known set',
      topRank: 1500,
    });
  });

  it('returns the B1 calibration tokens', () => {
    expect(calibrationCopy(CefrLevel.B1)).toEqual({
      eyebrow: '~B1+ calibration',
      explanation:
        'showing words rarer than top-3000 · refined by your known set',
      topRank: 3000,
    });
  });

  it('returns the B2 calibration tokens', () => {
    expect(calibrationCopy(CefrLevel.B2)).toEqual({
      eyebrow: '~B2+ calibration',
      explanation:
        'showing words rarer than top-5000 · refined by your known set',
      topRank: 5000,
    });
  });

  it('returns the C1 calibration tokens', () => {
    expect(calibrationCopy(CefrLevel.C1)).toEqual({
      eyebrow: '~C1+ calibration',
      explanation:
        'showing words rarer than top-8000 · refined by your known set',
      topRank: 8000,
    });
  });

  it('returns the C2 calibration tokens', () => {
    expect(calibrationCopy(CefrLevel.C2)).toEqual({
      eyebrow: '~C2+ calibration',
      explanation:
        'showing words rarer than top-12000 · refined by your known set',
      topRank: 12000,
    });
  });

  it('falls back to a null-band copy when no profile is set', () => {
    expect(calibrationCopy(null)).toEqual({
      eyebrow: 'your calibration',
      explanation: 'showing words above your current band',
      topRank: null,
    });
  });
});
