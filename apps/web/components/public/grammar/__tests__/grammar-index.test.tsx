import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { groupTopicsByLevel, GrammarIndexBody } from '../grammar-index';
import type { PublicTopicSummary } from '@language-drill/api-client';

const topic = (over: Partial<PublicTopicSummary>): PublicTopicSummary => ({
  id: 'a2-preterite',
  title: 'Preterite',
  cefr: 'A2',
  subtitle: 'Finished events.',
  category: 'tenses',
  order: 3,
  hasConjugationDrill: false,
  ...over,
});

describe('groupTopicsByLevel', () => {
  it('orders levels A1→B2 and sorts within a level by curriculum order', () => {
    const groups = groupTopicsByLevel([
      topic({ id: 'b1-x', cefr: 'B1', order: 2 }),
      topic({ id: 'a1-late', cefr: 'A1', order: 9 }),
      topic({ id: 'a1-early', cefr: 'A1', order: 1 }),
    ]);
    expect(groups.map((g) => g.level)).toEqual(['A1', 'B1']);
    expect(groups[0].topics.map((t) => t.id)).toEqual(['a1-early', 'a1-late']);
  });

  it('puts a null order last and breaks the tie by title', () => {
    const groups = groupTopicsByLevel([
      topic({ id: 'z', cefr: 'A1', order: null, title: 'Zebra' }),
      topic({ id: 'a', cefr: 'A1', order: null, title: 'Apple' }),
      topic({ id: 'ordered', cefr: 'A1', order: 5, title: 'Middle' }),
    ]);
    expect(groups[0].topics.map((t) => t.id)).toEqual(['ordered', 'a', 'z']);
  });

  it('keeps an unexpected CEFR value rather than dropping the topic', () => {
    const groups = groupTopicsByLevel([topic({ cefr: 'C1' })]);
    expect(groups.map((g) => g.level)).toEqual(['C1']);
  });
});

describe('GrammarIndexBody', () => {
  it('links every topic and marks only the ones with a drill', () => {
    render(
      <GrammarIndexBody
        lang="ES"
        topics={[
          topic({ id: 'a2-preterite', title: 'Preterite', hasConjugationDrill: true }),
          topic({ id: 'a1-noun-gender', title: 'Noun gender', cefr: 'A1', hasConjugationDrill: false }),
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: /Preterite/ })).toHaveAttribute(
      'href',
      '/spanish/grammar/a2-preterite',
    );
    expect(screen.getByRole('link', { name: /Noun gender/ })).toHaveAttribute(
      'href',
      '/spanish/grammar/a1-noun-gender',
    );
    // The pill is the honest signal: only 38 of 312 topics have a public drill,
    // so it belongs here rather than as a promise on every topic page.
    const drillMarkers = screen.getAllByText(/conjugation drill/i);
    expect(drillMarkers).toHaveLength(1);
  });

  it('renders each topic subtitle, so the list is readable content not just links', () => {
    render(<GrammarIndexBody lang="ES" topics={[topic({ subtitle: 'Finished events.' })]} />);
    expect(screen.getByText('Finished events.')).toBeInTheDocument();
  });

  it('shows the per-level count', () => {
    render(
      <GrammarIndexBody lang="ES" topics={[topic({ id: 'a' }), topic({ id: 'b' })]} />,
    );
    expect(screen.getByText('2 topics')).toBeInTheDocument();
  });
});
