import { describe, it, expect } from 'vitest';
import {
  filterTopics,
  sortTopics,
  groupTopics,
  highlightMatch,
  type LibraryTopic,
} from './group-sort';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function topic(overrides: Partial<LibraryTopic> & { id: string }): LibraryTopic {
  return {
    title: overrides.title ?? overrides.id,
    cefr: overrides.cefr ?? 'B1',
    category: overrides.category ?? 'other',
    order: overrides.order ?? null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// filterTopics
// ---------------------------------------------------------------------------

describe('filterTopics', () => {
  const topics = [
    topic({ id: 'a', title: 'present subjunctive', cefr: 'B1' }),
    topic({ id: 'b', title: 'compound tenses', cefr: 'B2' }),
    topic({ id: 'c', title: 'vowel harmony', cefr: 'A1' }),
  ];

  it('returns the input unchanged for a blank/whitespace query', () => {
    expect(filterTopics(topics, '')).toEqual(topics);
    expect(filterTopics(topics, '   ')).toEqual(topics);
  });

  it('matches against the title, case-insensitively', () => {
    expect(filterTopics(topics, 'SUBJ').map((t) => t.id)).toEqual(['a']);
  });

  it('matches against the cefr label', () => {
    expect(filterTopics(topics, 'b2').map((t) => t.id)).toEqual(['b']);
  });

  it('returns [] when nothing matches', () => {
    expect(filterTopics(topics, 'zzz')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sortTopics
// ---------------------------------------------------------------------------

describe('sortTopics', () => {
  it('alpha: sorts by title via localeCompare and does not mutate the input', () => {
    const input = [
      topic({ id: 'z', title: 'zebra' }),
      topic({ id: 'a', title: 'apple' }),
      topic({ id: 'm', title: 'mango' }),
    ];
    const snapshot = input.map((t) => t.id);
    const sorted = sortTopics(input, 'alpha');
    expect(sorted.map((t) => t.title)).toEqual(['apple', 'mango', 'zebra']);
    expect(input.map((t) => t.id)).toEqual(snapshot); // not mutated
  });

  it('curriculum: orders by `order` ascending', () => {
    const input = [
      topic({ id: 'c', order: 5 }),
      topic({ id: 'a', order: 1 }),
      topic({ id: 'b', order: 3 }),
    ];
    expect(sortTopics(input, 'curriculum').map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('curriculum: sorts null-order topics last, tie-broken by title', () => {
    const input = [
      topic({ id: 'n2', title: 'beta', order: null }),
      topic({ id: 'o1', title: 'ordered', order: 2 }),
      topic({ id: 'n1', title: 'alpha', order: null }),
    ];
    expect(sortTopics(input, 'curriculum').map((t) => t.id)).toEqual([
      'o1', // has an order → first
      'n1', // null, title 'alpha'
      'n2', // null, title 'beta'
    ]);
  });
});

// ---------------------------------------------------------------------------
// groupTopics
// ---------------------------------------------------------------------------

describe('groupTopics', () => {
  const topics = [
    topic({ id: 't1', title: 'compound tenses', cefr: 'B2', category: 'tenses', order: 7 }),
    topic({ id: 't2', title: 'present subjunctive', cefr: 'B1', category: 'moods', order: 1 }),
    topic({ id: 't3', title: 'vowel harmony', cefr: 'A1', category: 'orthography', order: 0 }),
    topic({ id: 't4', title: 'locative case', cefr: 'A1', category: 'cases', order: 3 }),
  ];

  it("category: groups in taxonomy order with empties dropped", () => {
    const groups = groupTopics(topics, 'category', 'curriculum', '');
    // Taxonomy order: tenses(1) < moods(2) < cases(5) < orthography(9).
    expect(groups.map((g) => g.id)).toEqual([
      'tenses',
      'moods',
      'cases',
      'orthography',
    ]);
    // Labels come from THEORY_CATEGORIES, not the raw id.
    expect(groups[0].label).toBe('verb tenses');
    // Empty categories (pairs, syntax, …) are not rendered.
    expect(groups.some((g) => g.id === 'pairs')).toBe(false);
  });

  it("category: places 'other' last", () => {
    const withOther = [...topics, topic({ id: 't5', title: 'misc', category: 'other' })];
    const groups = groupTopics(withOther, 'category', 'curriculum', '');
    expect(groups[groups.length - 1].id).toBe('other');
  });

  it('level: groups under A1…C2 order, empties dropped', () => {
    const groups = groupTopics(topics, 'level', 'alpha', '');
    expect(groups.map((g) => g.id)).toEqual(['A1', 'B1', 'B2']);
    // A1 bucket holds both A1 topics, alpha-sorted.
    const a1 = groups.find((g) => g.id === 'A1');
    expect(a1?.topics.map((t) => t.title)).toEqual(['locative case', 'vowel harmony']);
  });

  it('level: buckets a CEFR range by its first token (B1–B2 → B1)', () => {
    const ranged = [topic({ id: 'r', title: 'ranged', cefr: 'B1–B2', category: 'moods' })];
    const groups = groupTopics(ranged, 'level', 'curriculum', '');
    expect(groups.map((g) => g.id)).toEqual(['B1']);
  });

  it('none: returns a single all-topics group sorted by the active sort', () => {
    const groups = groupTopics(topics, 'none', 'curriculum', '');
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('all');
    // curriculum order: t3(0) < t2(1) < t4(3) < t1(7)
    expect(groups[0].topics.map((t) => t.id)).toEqual(['t3', 't2', 't4', 't1']);
  });

  it('search: collapses to a single results group sorted by the active sort', () => {
    // groupBy is ignored when a query is present. 'cas' matches only the two
    // topics whose title contains it.
    const groups = groupTopics(topics, 'category', 'alpha', 'cas');
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('results');
    expect(groups[0].topics.map((t) => t.title)).toEqual(['locative case']);
  });

  it('search: ignores groupBy and applies the active sort across all matches', () => {
    // 'e' appears in every fixture title; alpha sort orders the four matches.
    const groups = groupTopics(topics, 'level', 'alpha', 'e');
    expect(groups).toHaveLength(1);
    expect(groups[0].topics.map((t) => t.title)).toEqual([
      'compound tenses',
      'locative case',
      'present subjunctive',
      'vowel harmony',
    ]);
  });

  it('search: returns [] when nothing matches', () => {
    expect(groupTopics(topics, 'category', 'curriculum', 'zzzzz')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// highlightMatch
// ---------------------------------------------------------------------------

describe('highlightMatch', () => {
  it('splits the title around the match, preserving original casing', () => {
    expect(highlightMatch('Present Subjunctive', 'subj')).toEqual({
      before: 'Present ',
      match: 'Subj',
      after: 'unctive',
    });
  });

  it('returns null for a blank query', () => {
    expect(highlightMatch('anything', '   ')).toBeNull();
  });

  it('returns null when there is no match', () => {
    expect(highlightMatch('compound tenses', 'xyz')).toBeNull();
  });

  it('matches at the start of the title', () => {
    expect(highlightMatch('vowel harmony', 'vowel')).toEqual({
      before: '',
      match: 'vowel',
      after: ' harmony',
    });
  });
});
