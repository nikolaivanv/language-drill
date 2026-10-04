import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickCheck } from '../quick-check';
import type { QuickCheckItem } from '@language-drill/api-client';

const items: QuickCheckItem[] = [
  { sentence: 'Ayer ___ en un restaurante.', instructions: 'Type the preterite.', correctAnswer: 'comí', acceptableAnswers: [] },
  { sentence: 'De niño ___ en casa.', instructions: 'Type the imperfect.', correctAnswer: 'comía', acceptableAnswers: [] },
  { sentence: 'Hoy ___ cansado.', instructions: 'Type the present.', correctAnswer: 'estoy', acceptableAnswers: [] },
];

describe('QuickCheck', () => {
  it('renders nothing when there are no items', () => {
    // 97 of 312 topics have no usable rows; the section must be absent, not empty.
    const { container } = render(<QuickCheck items={[]} drillHref={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('accepts the correct answer', async () => {
    render(<QuickCheck items={items} drillHref={null} />);
    await userEvent.type(screen.getByRole('textbox'), 'comí');
    await userEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(screen.getByText(/right/i)).toBeInTheDocument();
  });

  it('rejects a wrong answer and shows the correct form', async () => {
    render(<QuickCheck items={items} drillHref={null} />);
    await userEvent.type(screen.getByRole('textbox'), 'comía');
    await userEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(screen.getByText(/not quite/i)).toBeInTheDocument();
    expect(screen.getByText('comí')).toBeInTheDocument();
  });

  it('treats a missing accent as wrong', async () => {
    // gradeFluencyAnswer does not strip diacritics: é/ü/ı are meaningful.
    render(<QuickCheck items={items} drillHref={null} />);
    await userEvent.type(screen.getByRole('textbox'), 'comi');
    await userEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(screen.getByText(/not quite/i)).toBeInTheDocument();
  });

  it('accepts a trailing period and different case', async () => {
    render(<QuickCheck items={items} drillHref={null} />);
    await userEvent.type(screen.getByRole('textbox'), 'Comí.');
    await userEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(screen.getByText(/right/i)).toBeInTheDocument();
  });

  it('shows a score after the last item and offers the drill when there is one', async () => {
    render(<QuickCheck items={items} drillHref="/try/forms?lang=ES&level=A2" />);
    for (const answer of ['comí', 'comía', 'estoy']) {
      await userEvent.type(screen.getByRole('textbox'), answer);
      await userEvent.click(screen.getByRole('button', { name: /check/i }));
      await userEvent.click(screen.getByRole('button', { name: /next|see result/i }));
    }
    expect(screen.getByText(/3 of 3/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /drill/i })).toHaveAttribute(
      'href', '/try/forms?lang=ES&level=A2',
    );
  });

  it('does not offer a drill link when the point has no pool', async () => {
    render(<QuickCheck items={items} drillHref={null} />);
    for (const answer of ['x', 'y', 'z']) {
      await userEvent.type(screen.getByRole('textbox'), answer);
      await userEvent.click(screen.getByRole('button', { name: /check/i }));
      await userEvent.click(screen.getByRole('button', { name: /next|see result/i }));
    }
    expect(screen.getByText(/0 of 3/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /drill/i })).toBeNull();
  });

  it('ignores a submit with an empty field', async () => {
    render(<QuickCheck items={items} drillHref={null} />);
    expect(screen.getByRole('button', { name: /check/i })).toBeDisabled();
  });

  it('records one result when two submits land in the same tick', async () => {
    // Regression test: `advance()` always increments the index by exactly one
    // per click no matter how many results got pushed, so an assertion on the
    // item counter alone cannot distinguish a double-push from the real
    // (single) one — it was tried first here and verified NOT to fail against
    // the pre-fix component (see task-8-report.md fix section). The final
    // score is what a duplicate push actually corrupts: a race that
    // double-counts item 1's correct answer inflates "1 of 3" to "2 of 3".
    render(<QuickCheck items={items} drillHref={null} />);
    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'comí'); // correct for item 1

    // Both handlers run against the same state, which is the real race: a held
    // Enter key, or Enter racing a click on Check. `setShowFeedback(true)`
    // does not take effect until the next render, so a state flag alone would
    // not stop the second call inside this same tick.
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await userEvent.click(screen.getByRole('button', { name: /next|see result/i }));

    // Items 2 and 3, both deliberately wrong.
    await userEvent.type(screen.getByRole('textbox'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /check/i }));
    await userEvent.click(screen.getByRole('button', { name: /next|see result/i }));
    await userEvent.type(screen.getByRole('textbox'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /check/i }));
    await userEvent.click(screen.getByRole('button', { name: /next|see result/i }));

    expect(screen.getByText(/1 of 3/i)).toBeInTheDocument();
  });
});
