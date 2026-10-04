import { describe, it, expect } from 'vitest';
import {
  LANDING_PATH,
  LANGUAGE_LABEL,
  grammarIndexHref,
  grammarTopicHref,
  publicLevelFor,
  tryFormsHref,
} from './public-paths';

describe('public paths', () => {
  it('uses language names, not codes', () => {
    expect(LANDING_PATH.ES).toBe('/spanish');
    expect(grammarIndexHref('DE')).toBe('/german/grammar');
    expect(grammarTopicHref('TR', 'a1-vowel-harmony')).toBe('/turkish/grammar/a1-vowel-harmony');
  });

  it('encodes a topic id so a stray character cannot break the href', () => {
    expect(grammarTopicHref('ES', 'a2-ser vs estar')).toBe('/spanish/grammar/a2-ser%20vs%20estar');
  });

  it('builds a point-targeted drill href', () => {
    expect(tryFormsHref('ES', 'A2', 'es-a2-preterite')).toBe(
      '/try/forms?lang=ES&level=A2&point=es-a2-preterite',
    );
  });

  it('omits the point when there is none', () => {
    expect(tryFormsHref('ES', 'A2')).toBe('/try/forms?lang=ES&level=A2');
  });

  it('labels each public language without casting onto the Language enum', () => {
    expect(LANGUAGE_LABEL.ES).toBe('Spanish');
    expect(LANGUAGE_LABEL.DE).toBe('German');
    expect(LANGUAGE_LABEL.TR).toBe('Turkish');
  });

  describe('publicLevelFor', () => {
    it('narrows a level the public drill offers for that language', () => {
      expect(publicLevelFor('ES', 'A2')).toBe('A2');
      expect(publicLevelFor('TR', 'B2')).toBe('B2'); // TR offers B2; ES/DE do not
    });

    it('returns null for a level that language does not offer', () => {
      expect(publicLevelFor('ES', 'B2')).toBeNull(); // ES pool has no approved B2 conjugation rows
      expect(publicLevelFor('DE', 'B2')).toBeNull();
    });

    it('returns null for a CEFR value outside the public set entirely', () => {
      expect(publicLevelFor('ES', 'C1')).toBeNull();
      expect(publicLevelFor('ES', '')).toBeNull();
    });
  });
});
