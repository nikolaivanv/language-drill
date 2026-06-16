import { describe, expect, it } from 'vitest';
import { SkillMovementSchema, SKILL_MOVEMENT_BANDS } from './skill-movement.js';

describe('SkillMovementSchema', () => {
  it('accepts a valid banded movement with no numeric score fields', () => {
    const m = { grammarPointKey: 'es-b2-present-subjunctive', label: 'Presente de subjuntivo', band: 'strong-gain', confidence: 'high' };
    expect(SkillMovementSchema.parse(m)).toEqual(m);
  });

  it('rejects an unknown band', () => {
    expect(() =>
      SkillMovementSchema.parse({ grammarPointKey: 'x', label: 'X', band: 'mega-gain', confidence: 'high' }),
    ).toThrow();
  });

  it('enumerates exactly the five bands', () => {
    expect([...SKILL_MOVEMENT_BANDS]).toEqual(['new', 'strong-gain', 'gain', 'steady', 'slip']);
  });
});
