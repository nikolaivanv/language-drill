import { describe, it, expect } from 'vitest';
import { Language } from '@language-drill/shared';
import {
  ProgressRadarResponseSchema,
  type ProgressRadarResponse,
} from './progress';

// ---------------------------------------------------------------------------
// Canonical valid payloads. Each rejection case mutates exactly one field so
// the failure mode is unambiguous.
// ---------------------------------------------------------------------------

const validRadarPayload: ProgressRadarResponse = {
  language: Language.ES,
  axes: [
    {
      key: 'listening',
      label: 'listening',
      currentMastery: 0,
      previousMastery: 0,
      lastPracticedAt: null,
      evidenceCount: 0,
    },
    {
      key: 'reading',
      label: 'reading',
      currentMastery: 0.88,
      previousMastery: 0.84,
      lastPracticedAt: '2026-04-15T12:00:00.000Z',
      evidenceCount: 12,
    },
    {
      key: 'speaking',
      label: 'speaking',
      currentMastery: 0,
      previousMastery: 0,
      lastPracticedAt: null,
      evidenceCount: 0,
    },
    {
      key: 'writing',
      label: 'writing',
      currentMastery: 0.5,
      previousMastery: 0.4,
      lastPracticedAt: '2026-04-10T12:00:00.000Z',
      evidenceCount: 4,
    },
    {
      key: 'grammar',
      label: 'grammar',
      currentMastery: 0.7,
      previousMastery: 0.6,
      lastPracticedAt: '2026-04-30T12:00:00.000Z',
      evidenceCount: 23,
    },
    {
      key: 'vocabulary',
      label: 'vocabulary',
      currentMastery: 0.65,
      previousMastery: 0.6,
      lastPracticedAt: '2026-04-28T12:00:00.000Z',
      evidenceCount: 8,
    },
  ],
};

// ---------------------------------------------------------------------------
// ProgressRadarResponseSchema
// ---------------------------------------------------------------------------

describe('ProgressRadarResponseSchema', () => {
  it('round-trips a valid payload', () => {
    const result = ProgressRadarResponseSchema.safeParse(validRadarPayload);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(validRadarPayload);
  });

  it('rejects axes.length !== 6 (too few)', () => {
    const payload = {
      ...validRadarPayload,
      axes: validRadarPayload.axes.slice(0, 5),
    };
    expect(ProgressRadarResponseSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects axes.length !== 6 (too many)', () => {
    const payload = {
      ...validRadarPayload,
      axes: [...validRadarPayload.axes, validRadarPayload.axes[0]],
    };
    expect(ProgressRadarResponseSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects currentMastery > 1', () => {
    const payload = {
      ...validRadarPayload,
      axes: validRadarPayload.axes.map((a, i) =>
        i === 0 ? { ...a, currentMastery: 1.1 } : a,
      ),
    };
    expect(ProgressRadarResponseSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects negative previousMastery', () => {
    const payload = {
      ...validRadarPayload,
      axes: validRadarPayload.axes.map((a, i) =>
        i === 0 ? { ...a, previousMastery: -0.1 } : a,
      ),
    };
    expect(ProgressRadarResponseSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects unknown axis keys', () => {
    const payload = {
      ...validRadarPayload,
      axes: validRadarPayload.axes.map((a, i) =>
        i === 0 ? { ...a, key: 'mystery' } : a,
      ),
    };
    expect(ProgressRadarResponseSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects language 'EN'", () => {
    const payload = { ...validRadarPayload, language: 'EN' };
    expect(ProgressRadarResponseSchema.safeParse(payload).success).toBe(false);
  });

  it('accepts a non-integer evidenceCount? no — rejects it', () => {
    const payload = {
      ...validRadarPayload,
      axes: validRadarPayload.axes.map((a, i) =>
        i === 0 ? { ...a, evidenceCount: 1.5 } : a,
      ),
    };
    expect(ProgressRadarResponseSchema.safeParse(payload).success).toBe(false);
  });
});

