import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Language } from '@language-drill/shared';
import { TheoryTrigger } from '../theory-trigger';

describe('TheoryTrigger', () => {
  it('renders the topic title in the pill label', () => {
    render(
      <TheoryTrigger
        topicId="subjunctive"
        language={Language.ES}
        onOpen={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: /theory · el subjuntivo/i }),
    ).toBeInTheDocument();
  });

  it('sets aria-haspopup="dialog"', () => {
    render(
      <TheoryTrigger
        topicId="subjunctive"
        language={Language.ES}
        onOpen={vi.fn()}
      />,
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('invokes onOpen with the topic id and the button element on click', () => {
    const onOpen = vi.fn();
    render(
      <TheoryTrigger
        topicId="subjunctive"
        language={Language.ES}
        onOpen={onOpen}
      />,
    );
    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith('subjunctive', button);
  });

  it('renders nothing when the topic does not exist for the language', () => {
    // 'subjunctive' is mapped, but DE registry is empty, so no topic exists.
    const { container } = render(
      <TheoryTrigger
        topicId={'subjunctive' as never}
        language={Language.DE}
        onOpen={vi.fn()}
      />,
    );
    expect(container.querySelector('button')).toBeNull();
  });
});
