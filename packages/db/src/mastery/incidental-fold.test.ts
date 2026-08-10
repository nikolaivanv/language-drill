import { describe, expect, it } from 'vitest';
import { incidentalObservations } from './incidental-fold';
import type { EvaluationError } from '@language-drill/shared';

const e = (over: Partial<EvaluationError>): EvaluationError => ({
  type: 'grammar', severity: 'major', text: 'x', correction: 'y', explanation: 'z', ...over,
});
const at = new Date('2026-06-20T00:00:00Z');

describe('incidentalObservations', () => {
  it('emits a negative obs only for attributed keys that differ from the host', () => {
    const out = incidentalObservations(
      [
        e({ grammarPointKey: 'tr-a1-vowel-harmony', severity: 'major' }), // incidental
        e({ grammarPointKey: 'tr-a1-locative' }),                          // == host → skip
        e({ grammarPointKey: null }),                                      // unattributed → skip
        e({ grammarPointKey: 'tr-a1-plural-suffix', severity: 'minor' }),  // incidental, minor
      ],
      'tr-a1-locative',
      at,
    );
    expect(out).toEqual([
      { grammarPointKey: 'tr-a1-vowel-harmony', score: 0, at },
      { grammarPointKey: 'tr-a1-plural-suffix', score: 0.4, at },
    ]);
  });

  it('dedups multiple incidental errors on the same point to the worst (lowest) score', () => {
    const out = incidentalObservations(
      [
        e({ grammarPointKey: 'tr-a1-vowel-harmony', severity: 'minor' }),
        e({ grammarPointKey: 'tr-a1-vowel-harmony', severity: 'major' }),
      ],
      'tr-a1-locative',
      at,
    );
    expect(out).toEqual([{ grammarPointKey: 'tr-a1-vowel-harmony', score: 0, at }]);
  });

  it('returns [] when host is null (no incidental distinction possible)', () => {
    expect(incidentalObservations([e({ grammarPointKey: 'tr-a1-vowel-harmony' })], null, at)).toEqual([]);
  });
});
