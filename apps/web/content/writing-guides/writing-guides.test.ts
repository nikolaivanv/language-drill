import { describe, it, expect } from 'vitest';
import {
  CefrLevel,
  Language,
  parseTheoryTopicJson,
  type LearningLanguage,
  type TheoryInlineJson,
} from '@language-drill/shared';
import {
  WRITING_GUIDE_BANDS,
  WRITING_GUIDE_SECTION_IDS,
  WRITING_GUIDE_BAND_LABELS,
  bandForLevel,
  getWritingGuide,
  isWritingGuideBand,
} from './index';

const LANGUAGES: LearningLanguage[] = [Language.ES, Language.DE, Language.TR];

describe('writing guides', () => {
  for (const language of LANGUAGES) {
    for (const band of WRITING_GUIDE_BANDS) {
      describe(`${language} ${band}`, () => {
        const guide = getWritingGuide(language, band);

        it('is a valid theory topic', () => {
          expect(() => parseTheoryTopicJson(guide)).not.toThrow();
        });

        it('is identified by language and band', () => {
          expect(guide.id).toBe(`${language.toLowerCase()}-${band}`);
          expect(guide.cefr).toBe(WRITING_GUIDE_BAND_LABELS[band]);
        });

        it('has exactly the seven guide sections, in order', () => {
          expect(guide.sections.map((s) => s.id)).toEqual([...WRITING_GUIDE_SECTION_IDS]);
        });

        it('includes at least one target-language example in the model and mistakes sections', () => {
          for (const id of ['paragraph-shape', 'common-mistakes']) {
            const section = guide.sections.find((s) => s.id === id)!;
            const json = JSON.stringify(section.body);
            expect(json, id).toContain('"kind":"example"');
          }
        });
      });
    }
  }
});

// B1–B2 prompts include comparison angles, not only opinions: each guide must
// teach the comparing connectors and model a comparison paragraph that uses one.
const COMPARING: Record<LearningLanguage, { connectors: string[]; inModel: string }> = {
  [Language.ES]: { connectors: ['mientras que', 'en cambio', 'al igual que'], inModel: 'mientras que' },
  [Language.DE]: { connectors: ['während', 'im Gegensatz zu', 'genauso wie'], inModel: 'während' },
  [Language.TR]: { connectors: ['oysa', '-e göre', 'gibi'], inModel: 'oysa' },
};

function inlineText(inlines: TheoryInlineJson[]): string {
  return inlines.map((i) => ('text' in i ? i.text : inlineText(i.children))).join('');
}

describe('b1-b2 comparison coverage', () => {
  for (const language of LANGUAGES) {
    const guide = getWritingGuide(language, 'b1-b2');
    const section = (id: string) => guide.sections.find((s) => s.id === id)!;
    const { connectors, inModel } = COMPARING[language];

    it(`${language}: the connectors section teaches the three comparing connectors`, () => {
      const json = JSON.stringify(section('connectors').body);
      for (const c of connectors) expect(json.includes(`"text":"${c}"`), c).toBe(true);
    });

    it(`${language}: the paragraph-shape section models a comparison using "${inModel}"`, () => {
      const targets = section('paragraph-shape')
        .body.filter((b) => b.kind === 'example')
        .map((b) => inlineText(b.target).toLowerCase());
      expect(targets.some((t) => t.includes(inModel.toLowerCase()))).toBe(true);
    });
  }
});

describe('bandForLevel', () => {
  it.each([
    [CefrLevel.A1, 'a1-a2'],
    [CefrLevel.A2, 'a1-a2'],
    [CefrLevel.B1, 'b1-b2'],
    [CefrLevel.B2, 'b1-b2'],
    [CefrLevel.C1, 'b1-b2'],
    [CefrLevel.C2, 'b1-b2'],
  ])('%s → %s', (level, band) => {
    expect(bandForLevel(level)).toBe(band);
  });
});

describe('isWritingGuideBand', () => {
  it('accepts only the two bands', () => {
    expect(isWritingGuideBand('a1-a2')).toBe(true);
    expect(isWritingGuideBand('b1-b2')).toBe(true);
    for (const v of ['c1', '', 'A1-A2', null, undefined, 3]) {
      expect(isWritingGuideBand(v)).toBe(false);
    }
  });
});
