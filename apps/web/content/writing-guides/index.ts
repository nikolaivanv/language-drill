// Free-writing guides — one hand-authored theory topic per language × level
// band, read before an attempt (/drill/free-writing/guide). Content is the
// grammar-theory JSON format so the theory renderer draws it unchanged; each
// file is parsed once here so a malformed guide fails at import and in tests,
// never silently at render.
import {
  CefrLevel,
  Language,
  parseTheoryTopicJson,
  type LearningLanguage,
  type TheoryTopicJson,
} from '@language-drill/shared';
import esA1A2 from './es-a1-a2.json';
import esB1B2 from './es-b1-b2.json';
import deA1A2 from './de-a1-a2.json';
import deB1B2 from './de-b1-b2.json';
import trA1A2 from './tr-a1-a2.json';
import trB1B2 from './tr-b1-b2.json';

export type WritingGuideBand = 'a1-a2' | 'b1-b2';

export const WRITING_GUIDE_BANDS: readonly WritingGuideBand[] = ['a1-a2', 'b1-b2'];

export const WRITING_GUIDE_BAND_LABELS: Record<WritingGuideBand, string> = {
  'a1-a2': 'A1–A2',
  'b1-b2': 'B1–B2',
};

export const WRITING_GUIDE_SECTION_IDS: readonly string[] = [
  'what-is-graded',
  'paragraph-shape',
  'connectors',
  'register',
  'task-and-length',
  'common-mistakes',
  'checklist',
];

const GUIDES: Record<LearningLanguage, Record<WritingGuideBand, TheoryTopicJson>> = {
  [Language.ES]: { 'a1-a2': parseTheoryTopicJson(esA1A2), 'b1-b2': parseTheoryTopicJson(esB1B2) },
  [Language.DE]: { 'a1-a2': parseTheoryTopicJson(deA1A2), 'b1-b2': parseTheoryTopicJson(deB1B2) },
  [Language.TR]: { 'a1-a2': parseTheoryTopicJson(trA1A2), 'b1-b2': parseTheoryTopicJson(trB1B2) },
};

export function bandForLevel(level: CefrLevel): WritingGuideBand {
  return level === CefrLevel.A1 || level === CefrLevel.A2 ? 'a1-a2' : 'b1-b2';
}

export function isWritingGuideBand(value: unknown): value is WritingGuideBand {
  return value === 'a1-a2' || value === 'b1-b2';
}

export function getWritingGuide(language: LearningLanguage, band: WritingGuideBand): TheoryTopicJson {
  return GUIDES[language][band];
}
