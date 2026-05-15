import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  getStaticTheoryTopic,
  listStaticTheoryTopics,
  theoryRegistry,
} from '..';
import { Language } from '@language-drill/shared';

describe('theory registry · ES topics', () => {
  const esTopics = Object.values(theoryRegistry.ES);

  it('has at least one topic registered for ES', () => {
    expect(esTopics.length).toBeGreaterThan(0);
  });

  it.each(esTopics.map((t) => [t.id, t]))(
    'topic "%s" has non-empty title, subtitle, cefr, and at least one section',
    (_id, topic) => {
      expect(topic.title).toBeTruthy();
      expect(topic.subtitle).toBeTruthy();
      expect(topic.cefr).toBeTruthy();
      expect(topic.sections.length).toBeGreaterThan(0);
    },
  );

  it.each(esTopics.map((t) => [t.id, t]))(
    'topic "%s" has unique section ids',
    (_id, topic) => {
      const ids = topic.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  it.each(
    esTopics.flatMap((t) =>
      t.sections.map((s) => [t.id, s.id, s] as const),
    ),
  )('topic "%s" section "%s" renders without throwing', (_t, _s, section) => {
    expect(() => render(<>{section.body}</>)).not.toThrow();
  });
});

describe('getStaticTheoryTopic', () => {
  it('returns the topic when present', () => {
    expect(getStaticTheoryTopic(Language.ES, 'subjunctive')).not.toBeNull();
    expect(getStaticTheoryTopic(Language.ES, 'preterite-imperfect')).not.toBeNull();
    expect(getStaticTheoryTopic(Language.ES, 'conditional')).not.toBeNull();
  });

  it('returns null for unknown topic ids', () => {
    expect(getStaticTheoryTopic(Language.ES, 'nonexistent')).toBeNull();
  });

  it('returns null for languages with empty registries (DE, TR in v1)', () => {
    expect(getStaticTheoryTopic(Language.DE, 'subjunctive')).toBeNull();
    expect(getStaticTheoryTopic(Language.TR, 'subjunctive')).toBeNull();
  });
});

describe('listStaticTheoryTopics', () => {
  it('returns all ES topics sorted by title', () => {
    const list = listStaticTheoryTopics(Language.ES);
    expect(list.length).toBe(Object.keys(theoryRegistry.ES).length);

    const titles = list.map((t) => t.title);
    const sorted = [...titles].sort((a, b) => a.localeCompare(b));
    expect(titles).toEqual(sorted);
  });

  it('returns only id, title, and cefr — not the section bodies', () => {
    const list = listStaticTheoryTopics(Language.ES);
    for (const t of list) {
      expect(Object.keys(t).sort()).toEqual(['cefr', 'id', 'title']);
    }
  });

  it('returns an empty array for languages with empty registries', () => {
    expect(listStaticTheoryTopics(Language.DE)).toEqual([]);
    expect(listStaticTheoryTopics(Language.TR)).toEqual([]);
  });
});
