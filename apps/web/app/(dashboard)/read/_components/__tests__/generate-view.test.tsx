import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  CefrLevel,
  ReadingCategory,
  ReadingTextLength,
  READING_IDEAS,
  READING_GEN_TOPIC_MAX_CHARS,
} from '@language-drill/shared';
import { GenerateView } from '../generate-view';
import type { GenerateState } from '../../_state/read-page-reducer';

// ---------------------------------------------------------------------------
// GenerateView — composer: topic textarea, idea chips, length/level controls,
// "you'll get" summary, generate gating, loader, rate-limit messaging.
// No language field/select anywhere.
// ---------------------------------------------------------------------------

const baseState: GenerateState = {
  topic: '',
  length: ReadingTextLength.SHORT,
  cefr: CefrLevel.B1,
  language: 'ES',
  category: null,
};

const defaultProps = {
  state: baseState,
  ideas: READING_IDEAS,
  languageLabel: 'español',
  yourLevel: null,
  onChange: () => {},
  onPickIdea: () => {},
  onGenerate: () => {},
  onCancel: () => {},
  isLoading: false,
  errorBody: null,
} as const;

describe('GenerateView — copy + header', () => {
  it('renders the eyebrow, title, and language-aware subtitle', () => {
    render(<GenerateView {...defaultProps} />);
    expect(screen.getByText(/new text/i)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /generate a passage/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/I'll write it in español/i),
    ).toBeInTheDocument();
  });

  it('has no language select/combobox', () => {
    render(<GenerateView {...defaultProps} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/language switcher/i),
    ).not.toBeInTheDocument();
  });
});

describe('GenerateView — topic textarea', () => {
  it('calls onChange("topic", value) when typing into the textarea', () => {
    const onChange = vi.fn();
    render(<GenerateView {...defaultProps} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/what to read about/i), {
      target: { value: 'el clima' },
    });
    expect(onChange).toHaveBeenCalledWith('topic', 'el clima');
  });

  it('shows the character counter and flips to accent past 200', () => {
    render(
      <GenerateView
        {...defaultProps}
        state={{ ...baseState, topic: 'a'.repeat(201) }}
      />,
    );
    const counter = screen.getByText('201 / 200');
    expect(counter.className).toContain('text-accent');
  });
});

describe('GenerateView — idea chips', () => {
  it('renders every idea prompt', () => {
    render(<GenerateView {...defaultProps} />);
    for (const idea of READING_IDEAS) {
      expect(screen.getByText(idea.prompt)).toBeInTheDocument();
    }
  });

  it('calls onPickIdea with the idea when a chip is clicked', () => {
    const onPickIdea = vi.fn();
    render(<GenerateView {...defaultProps} onPickIdea={onPickIdea} />);
    const idea = READING_IDEAS[2];
    fireEvent.click(screen.getByText(idea.prompt));
    expect(onPickIdea).toHaveBeenCalledWith(idea);
  });
});

describe('GenerateView — length + level controls', () => {
  it('calls onChange("length", value) when a length is picked', () => {
    const onChange = vi.fn();
    render(<GenerateView {...defaultProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /long/i }));
    expect(onChange).toHaveBeenCalledWith('length', ReadingTextLength.LONG);
  });

  it('calls onChange("cefr", value) when a level is picked', () => {
    const onChange = vi.fn();
    render(<GenerateView {...defaultProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^C1$/ }));
    expect(onChange).toHaveBeenCalledWith('cefr', CefrLevel.C1);
  });
});

describe('GenerateView — "you\'ll get" summary', () => {
  it('reflects length, category, level, and language from state', () => {
    render(
      <GenerateView
        {...defaultProps}
        state={{
          ...baseState,
          length: ReadingTextLength.LONG,
          cefr: CefrLevel.B2,
          category: ReadingCategory.STORY,
        }}
      />,
    );
    const summary = screen.getByText(/you'll get/i);
    expect(summary).toHaveTextContent(
      /you'll get a long \(~320 word\) story at B2 in español\./i,
    );
  });

  it('falls back to "passage" when no category is selected', () => {
    render(
      <GenerateView
        {...defaultProps}
        state={{ ...baseState, length: ReadingTextLength.SHORT, category: null }}
      />,
    );
    const summary = screen.getByText(/you'll get/i);
    expect(summary).toHaveTextContent(/~80 word\) passage at B1 in español\./i);
  });
});

describe('GenerateView — generate gating + callbacks', () => {
  it('disables "generate a passage →" when the topic is empty', () => {
    render(<GenerateView {...defaultProps} />);
    expect(
      screen.getByRole('button', { name: /generate a passage →/i }),
    ).toBeDisabled();
  });

  it('disables when the topic is whitespace-only', () => {
    render(
      <GenerateView
        {...defaultProps}
        state={{ ...baseState, topic: '   \n\t ' }}
      />,
    );
    expect(
      screen.getByRole('button', { name: /generate a passage →/i }),
    ).toBeDisabled();
  });

  it('disables when the topic is over the limit', () => {
    render(
      <GenerateView
        {...defaultProps}
        state={{ ...baseState, topic: 'a'.repeat(READING_GEN_TOPIC_MAX_CHARS + 1) }}
      />,
    );
    expect(
      screen.getByRole('button', { name: /generate a passage →/i }),
    ).toBeDisabled();
  });

  it('enables with a valid topic and fires onGenerate', () => {
    const onGenerate = vi.fn();
    render(
      <GenerateView
        {...defaultProps}
        state={{ ...baseState, topic: 'a day at the beach' }}
        onGenerate={onGenerate}
      />,
    );
    const cta = screen.getByRole('button', { name: /generate a passage →/i });
    expect(cta).not.toBeDisabled();
    fireEvent.click(cta);
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('fires onCancel when "cancel" is clicked', () => {
    const onCancel = vi.fn();
    render(<GenerateView {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('GenerateView — loading state', () => {
  it('shows "generating…" on the CTA and disables it while loading', () => {
    render(
      <GenerateView
        {...defaultProps}
        state={{ ...baseState, topic: 'a day at the beach' }}
        isLoading={true}
      />,
    );
    expect(
      screen.getByRole('button', { name: /generating…/i }),
    ).toBeDisabled();
  });
});

describe('GenerateView — error + rate-limit messaging', () => {
  it('renders the error body in a role="alert" when set', () => {
    render(
      <GenerateView
        {...defaultProps}
        errorBody="generation temporarily unavailable — try again in a moment."
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/generation temporarily unavailable/);
  });

  it('shows a rate-limit alert when rateLimited', () => {
    render(
      <GenerateView
        {...defaultProps}
        state={{ ...baseState, topic: 'a day at the beach' }}
        rateLimited={true}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/daily generation limit reached/i);
  });

  it('renders no alert when there is no error and not rate limited', () => {
    render(<GenerateView {...defaultProps} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
