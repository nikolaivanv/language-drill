import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { InsightsErrorTheme } from '@language-drill/api-client';
import { WorkOnThese } from '../work-on-these';

const theme = (over: Partial<InsightsErrorTheme> = {}): InsightsErrorTheme => ({
  grammarPointKey: 'tr-a1-locative',
  grammarPointName: 'Locative case',
  errorType: 'grammar',
  count: 6,
  majorCount: 4,
  lastOccurredAt: '2026-06-19T00:00:00.000Z',
  sample: { wrongText: 'pazarda', correction: 'pazara' },
  score: 4.2,
  ...over,
});

describe('WorkOnThese', () => {
  it('renders nothing when there are no themes', () => {
    const { container } = render(<WorkOnThese themes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the grammar point, the slip, and the count', () => {
    render(<WorkOnThese themes={[theme()]} />);
    expect(screen.getByText('Locative case')).toBeInTheDocument();
    expect(screen.getByText(/pazarda/)).toBeInTheDocument();
    expect(screen.getByText(/pazara/)).toBeInTheDocument();
    expect(screen.getByText(/6×/)).toBeInTheDocument();
  });

  it('falls back to the error type when grammar point name is null', () => {
    render(<WorkOnThese themes={[theme({ grammarPointKey: null, grammarPointName: null })]} />);
    expect(screen.getByText('grammar errors')).toBeInTheDocument();
  });

  it('falls back to the grammar point key when name is null', () => {
    render(<WorkOnThese themes={[theme({ grammarPointName: null })]} />);
    expect(screen.getByText('tr-a1-locative')).toBeInTheDocument();
  });

  it('caps the list at three themes', () => {
    const themes = ['a', 'b', 'c', 'd', 'e'].map((k, i) =>
      theme({ grammarPointKey: k, grammarPointName: `Point ${k}`, count: 10 - i }),
    );
    render(<WorkOnThese themes={themes} />);
    expect(screen.getByText('Point a')).toBeInTheDocument();
    expect(screen.queryByText('Point d')).not.toBeInTheDocument();
  });

  it('links each row to a drill targeted at its grammar point', () => {
    render(<WorkOnThese themes={[theme({ grammarPointKey: 'tr-a1-locative', grammarPointName: 'Locative case' })]} />);
    const link = screen.getByRole('link', { name: /Locative case/i });
    expect(link).toHaveAttribute('href', '/drill?start=quick&grammarPoint=tr-a1-locative');
  });

  it('renders a null-grammar-point row as plain text, not a link', () => {
    render(<WorkOnThese themes={[theme({ grammarPointKey: null, grammarPointName: null })]} />);
    expect(screen.queryByRole('link', { name: /grammar errors/i })).not.toBeInTheDocument();
    expect(screen.getByText('grammar errors')).toBeInTheDocument();
  });

  it('does not render a standalone "practice →" header link', () => {
    render(<WorkOnThese themes={[theme()]} />);
    expect(screen.queryByRole('link', { name: /practice/i })).not.toBeInTheDocument();
  });

  it('renders a Link when no onSelect is given', () => {
    render(<WorkOnThese themes={[theme()]} />);
    const link = screen.getByRole('link', { name: /Locative case/i });
    expect(link).toHaveAttribute('href', '/drill?start=quick&grammarPoint=tr-a1-locative');
  });

  it('renders a button calling onSelect(key) when onSelect is given', () => {
    const onSelect = vi.fn();
    render(<WorkOnThese themes={[theme()]} onSelect={onSelect} />);
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Locative case/i }));
    expect(onSelect).toHaveBeenCalledWith('tr-a1-locative');
  });

  it('keeps a keyless theme non-interactive even with onSelect', () => {
    const onSelect = vi.fn();
    render(
      <WorkOnThese themes={[theme({ grammarPointKey: null })]} onSelect={onSelect} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders identical first-3 items regardless of how the component is mounted — determinism test', () => {
    // This regression guards that WorkOnThese is the single place that limits
    // output to MAX_ITEMS (3) and preserves insertion order, so all three call
    // sites (home, drill hub, progress map-tab) that pass the raw
    // useInsightsErrors themes array always produce the same render.
    const fiveThemes = ['a', 'b', 'c', 'd', 'e'].map((k) =>
      theme({ grammarPointKey: k, grammarPointName: `Point ${k}` }),
    );

    const { unmount } = render(<WorkOnThese themes={fiveThemes} />);
    const firstLabels = screen
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    unmount();

    render(<WorkOnThese themes={fiveThemes} onSelect={vi.fn()} />);
    const secondLabels = screen
      .getAllByRole('listitem')
      .map((li) => li.textContent);

    // Both renders must show exactly 3 items in the same order.
    expect(firstLabels).toHaveLength(3);
    expect(secondLabels).toHaveLength(3);
    expect(firstLabels).toEqual(secondLabels);

    // The 3 items must be the first 3 from the input — input order is preserved.
    expect(screen.getByText('Point a')).toBeInTheDocument();
    expect(screen.getByText('Point b')).toBeInTheDocument();
    expect(screen.getByText('Point c')).toBeInTheDocument();
    expect(screen.queryByText('Point d')).not.toBeInTheDocument();
    expect(screen.queryByText('Point e')).not.toBeInTheDocument();
  });
});
