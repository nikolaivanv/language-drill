import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PracticeRail } from '../practice-rail';
import { TopicPager, type PagerNeighbour } from '../grammar-topic';
import { TopicBreadcrumbs } from '../topic-breadcrumbs';

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
