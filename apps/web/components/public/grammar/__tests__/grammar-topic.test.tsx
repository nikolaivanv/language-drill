import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { track } from '../../../../lib/analytics/track';
import { PracticeRail } from '../practice-rail';
import { TopicPager, GrammarTopic, type PagerNeighbour } from '../grammar-topic';
import { TopicBreadcrumbs } from '../topic-breadcrumbs';
import { fetchPublicTopic, fetchPublicTopicList } from '../../../../lib/public-theory';

vi.mock('../../../../lib/analytics/track', () => ({ track: vi.fn() }));

vi.mock('../../../../lib/public-theory', () => ({
  fetchPublicTopic: vi.fn(),
  fetchPublicTopicList: vi.fn(),
}));

// LegalLinks (pulled in via AppFooter) reads the ConsentProvider context,
// which isn't mounted in this test — same stub `drill-landing.test.tsx` uses.
vi.mock('../../../legal/legal-links', () => ({
  LegalLinks: () => <div data-testid="legal-links" />,
}));

const TOPIC_FIXTURE = {
  topic: {
    id: 'es-a2-ser-vs-estar',
    title: 'Ser vs estar',
    subtitle: 'Two verbs for one English verb.',
    cefr: 'A2',
    sections: [{ id: 'short', title: 'The short version', body: <p>Ser is essence.</p> }],
  },
  envelope: {
    related: { buildsOn: [], leadsTo: [], siblings: [] },
    hasConjugationDrill: false,
    quickCheck: [],
  },
  readingMinutes: 1,
};

const TOPIC_LIST = [
  { id: 'a2-imperfect', title: 'Imperfect', cefr: 'A2', subtitle: 'x', category: 'tenses', order: 1, hasConjugationDrill: false },
  { id: 'a2-ser-vs-estar', title: 'Ser vs estar', cefr: 'A2', subtitle: 'x', category: 'pairs', order: 2, hasConjugationDrill: false },
  { id: 'a2-dop', title: 'Direct object pronouns', cefr: 'A2', subtitle: 'x', category: 'pronouns', order: 3, hasConjugationDrill: false },
];

describe('PracticeRail', () => {
  it('offers the drill aimed at this point when one exists', () => {
    render(
      <PracticeRail
        lang="ES"
        cefr="A2"
        grammarPointKey="es-a2-preterite"
        hasConjugationDrill
      />,
    );
    expect(screen.getByRole('link', { name: /start drilling/i })).toHaveAttribute(
      'href', '/try/forms?lang=ES&level=A2&point=es-a2-preterite',
    );
  });

  it('offers only sign-up when the point has no public drill', () => {
    // True of 274 of 312 topics. Showing a drill card here would be a promise
    // the pool cannot keep.
    render(
      <PracticeRail
        lang="ES"
        cefr="A2"
        grammarPointKey="es-a2-noun-gender"
        hasConjugationDrill={false}
      />,
    );
    expect(screen.queryByRole('link', { name: /start drilling/i })).toBeNull();
    expect(screen.getByRole('link', { name: /sign up/i })).toBeInTheDocument();
  });

  it('tracks a click on the rail sign-up with the topic it came from', async () => {
    render(
      <PracticeRail lang="ES" cefr="A2" grammarPointKey="es-a2-x" hasConjugationDrill={false} />,
    );
    await userEvent.click(screen.getByRole('link', { name: /sign up free/i }));
    expect(track).toHaveBeenCalledWith('signup_cta_clicked', {
      surface: 'grammar_rail',
      language: 'ES',
      cefr: 'A2',
      grammarPoint: 'es-a2-x',
    });
  });

  it('never offers a coached session, which does not exist yet', () => {
    render(
      <PracticeRail lang="ES" cefr="A2" grammarPointKey="es-a2-x" hasConjugationDrill />,
    );
    expect(screen.queryByText(/coached/i)).toBeNull();
  });
});

describe('TopicPager', () => {
  const prev: PagerNeighbour = { id: 'a2-imperfect', title: 'Imperfect', cefr: 'A2' };
  const next: PagerNeighbour = { id: 'a2-dop', title: 'Direct object pronouns', cefr: 'A2' };

  it('links both neighbours', () => {
    render(<TopicPager lang="ES" previous={prev} next={next} />);
    expect(screen.getByRole('link', { name: /Imperfect/ })).toHaveAttribute(
      'href', '/spanish/grammar/a2-imperfect',
    );
    expect(screen.getByRole('link', { name: /Direct object pronouns/ })).toHaveAttribute(
      'href', '/spanish/grammar/a2-dop',
    );
  });

  it('renders one arm at the edge of a level', () => {
    render(<TopicPager lang="ES" previous={null} next={next} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('renders nothing when a level has a single topic', () => {
    const { container } = render(<TopicPager lang="ES" previous={null} next={null} />);
    expect(container.querySelector('nav')).toBeNull();
  });
});

describe('TopicBreadcrumbs', () => {
  it('emits a BreadcrumbList with the topic last', () => {
    render(<TopicBreadcrumbs lang="ES" cefr="A2" title="Ser vs estar" />);
    const script = document.querySelector('script[type="application/ld+json"]');
    const data = JSON.parse(script!.textContent!);
    expect(data['@type']).toBe('BreadcrumbList');
    expect(data.itemListElement).toHaveLength(3);
    expect(data.itemListElement[2].name).toBe('Ser vs estar');
    expect(data.itemListElement[1].item).toContain('/spanish/grammar');
  });
});

describe('GrammarTopic', () => {
  // The pager is an enhancement computed from the hub LIST fetch; the article
  // itself comes from a separate fetch with its own (unchanged) throw policy.
  // A list-endpoint outage must degrade to no pager, never take out the page.

  it('renders the pager when the list fetch succeeds', async () => {
    vi.mocked(fetchPublicTopic).mockResolvedValue(TOPIC_FIXTURE);
    vi.mocked(fetchPublicTopicList).mockResolvedValue(TOPIC_LIST);

    render(await GrammarTopic({ lang: 'ES', topicId: 'a2-ser-vs-estar' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Ser vs estar' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /more in this level/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Imperfect/ })).toBeInTheDocument();
  });

  it('degrades to no pager (and still renders the article) when the list fetch fails', async () => {
    vi.mocked(fetchPublicTopic).mockResolvedValue(TOPIC_FIXTURE);
    vi.mocked(fetchPublicTopicList).mockRejectedValue(new Error('POOL_UNAVAILABLE'));

    render(await GrammarTopic({ lang: 'ES', topicId: 'a2-ser-vs-estar' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Ser vs estar' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /more in this level/i })).toBeNull();
  });
});
