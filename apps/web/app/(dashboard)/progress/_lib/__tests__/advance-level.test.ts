import { describe, it, expect } from 'vitest';
import { CefrLevel, Language } from '@language-drill/shared';
import { withAdvancedLevel } from '../advance-level';

const p = (language: Language, proficiencyLevel: CefrLevel) => ({ language, proficiencyLevel });

describe('withAdvancedLevel', () => {
  it('bumps only the matching language, leaving the rest untouched', () => {
    const rows = [p(Language.TR, CefrLevel.A1), p(Language.ES, CefrLevel.B1)];
    const out = withAdvancedLevel(rows, Language.TR, CefrLevel.A2);
    expect(out).toEqual([p(Language.TR, CefrLevel.A2), p(Language.ES, CefrLevel.B1)]);
    expect(rows[0].proficiencyLevel).toBe(CefrLevel.A1); // input not mutated
  });
  it('returns the list unchanged when the language is absent', () => {
    const rows = [p(Language.ES, CefrLevel.B1)];
    expect(withAdvancedLevel(rows, Language.TR, CefrLevel.A2)).toEqual(rows);
  });
});
