import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  CefrLevel,
  ReadingTextLength,
  READING_GEN_TOPIC_MAX_CHARS,
} from '@language-drill/shared';
import { GenerateView, type GenerateState } from '../generate-view';

// ---------------------------------------------------------------------------
// GenerateView — chips, topic gating, CTA callbacks, loader, rate limit.
// ---------------------------------------------------------------------------

const baseState: GenerateState = {
  topic: '',
  length: ReadingTextLength.SHORT,
  cefr: CefrLevel.B1,
  language: 'ES',
};

const defaultProps = {
  state: baseState,
  chips: ['a day at the beach', 'a job interview', 'climate change'] as const,
  onChange: () => {},
  onChipPick: () => {},
  onGenerate: () => {},
  onCancel: () => {},
  isLoading: false,
  errorBody: null,
} as const;

describe('GenerateView — chips', () => {
  it('renders every suggestion chip', () => {
    render(<GenerateView {...defaultProps} />);
    for (const chip of defaultProps.chips) {
      expect(screen.getByText(chip)).toBeInTheDocument();
    }
  });

  it('calls onChipPick with the chip text when a chip is clicked', () => {
    const onChipPick = vi.fn();
    render(<GenerateView {...defaultProps} onChipPick={onChipPick} />);
    fireEvent.click(screen.getByText('a job interview'));
    expect(onChipPick).toHaveBeenCalledWith('a job interview');
  });

  it('disables chips while loading', () => {
    render(
      <GenerateView
        {...defaultProps}
        state={{ ...baseState, topic: 'something' }}
        isLoading={true}
      />,
    );
    // Each chip text lives inside a <button>; that button should be disabled.
    const chipButton = screen.getByText('climate change').closest('button');
    expect(chipButton).toBeDisabled();
  });
});

describe('GenerateView — topic input', () => {
  it('calls onChange("topic", value) when typing into the topic input', () => {
    const onChange = vi.fn();
    render(<GenerateView {...defaultProps} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/topic/i), {
      target: { value: 'el clima' },
    });
    expect(onChange).toHaveBeenCalledWith('topic', 'el clima');
  });

  it('flips the counter to accent + " · too long" past the max', () => {
    render(
      <GenerateView
        {...defaultProps}
        state={{
          ...baseState,
          topic: 'a'.repeat(READING_GEN_TOPIC_MAX_CHARS + 1),
        }}
      />,
    );
    const counter = screen.getByText(/· too long/);
    expect(counter.className).toContain('text-accent');
  });
});

describe('GenerateView — selectors', () => {
  it('calls onChange("length", value) when the length select changes', () => {
    const onChange = vi.fn();
    render(<GenerateView {...defaultProps} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/length/i), {
      target: { value: ReadingTextLength.LONG },
    });
    expect(onChange).toHaveBeenCalledWith('length', ReadingTextLength.LONG);
  });

  it('calls onChange("cefr", value) when the level select changes', () => {
    const onChange = vi.fn();
    render(<GenerateView {...defaultProps} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/level/i), {
      target: { value: CefrLevel.C1 },
    });
    expect(onChange).toHaveBeenCalledWith('cefr', CefrLevel.C1);
  });
});

describe('GenerateView — read-only language indicator', () => {
  it('renders the current language as a read-only indicator (no editable control)', () => {
    render(
      <GenerateView {...defaultProps} state={{ ...baseState, language: 'DE' }} />,
    );
    // The language code is shown read-only…
    expect(screen.getByText('DE')).toBeInTheDocument();
    // …with the human-readable label + switcher hint…
    expect(screen.getByText(/German/)).toBeInTheDocument();
    expect(screen.getByText(/language switcher/i)).toBeInTheDocument();
    // …and there is no editable language combobox to diverge from activeLanguage.
    expect(
      screen.queryByRole('combobox', { name: /language/i }),
    ).not.toBeInTheDocument();
  });
});

describe('GenerateView — generate gating + callbacks', () => {
  it('disables "generate →" when the topic is empty', () => {
    render(<GenerateView {...defaultProps} />);
    expect(
      screen.getByRole('button', { name: /generate →/i }),
    ).toBeDisabled();
  });

  it('disables "generate →" when the topic is whitespace-only', () => {
    render(
      <GenerateView
        {...defaultProps}
        state={{ ...baseState, topic: '   \n\t ' }}
      />,
    );
    expect(
      screen.getByRole('button', { name: /generate →/i }),
    ).toBeDisabled();
  });

  it('enables "generate →" with a non-empty topic and calls onGenerate', () => {
    const onGenerate = vi.fn();
    render(
      <GenerateView
        {...defaultProps}
        state={{ ...baseState, topic: 'a day at the beach' }}
        onGenerate={onGenerate}
      />,
    );
    const cta = screen.getByRole('button', { name: /generate →/i });
    expect(cta).not.toBeDisabled();
    fireEvent.click(cta);
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when "cancel" is clicked', () => {
    const onCancel = vi.fn();
    render(<GenerateView {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('GenerateView — loading state', () => {
  it('shows a role="status" loader with "generating your text…" while loading', () => {
    render(
      <GenerateView
        {...defaultProps}
        state={{ ...baseState, topic: 'a day at the beach' }}
        isLoading={true}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/generating your text…/i);
  });

  it('disables both action buttons while loading', () => {
    render(
      <GenerateView
        {...defaultProps}
        state={{ ...baseState, topic: 'a day at the beach' }}
        isLoading={true}
      />,
    );
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /generating…/i }),
    ).toBeDisabled();
  });
});

describe('GenerateView — rate limited', () => {
  it('disables "generate →" and shows a rate-limit message when rateLimited', () => {
    render(
      <GenerateView
        {...defaultProps}
        state={{ ...baseState, topic: 'a day at the beach' }}
        rateLimited={true}
      />,
    );
    expect(
      screen.getByRole('button', { name: /generate →/i }),
    ).toBeDisabled();
    expect(screen.getByText(/daily limit reached/i)).toBeInTheDocument();
  });
});

describe('GenerateView — errorBody card', () => {
  it('renders the inline error card when errorBody is non-null', () => {
    render(
      <GenerateView
        {...defaultProps}
        errorBody="generation temporarily unavailable — try again in a moment."
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("couldn't generate this");
    expect(alert).toHaveTextContent(/generation temporarily unavailable/);
  });

  it('hides the error card when errorBody is null and not rate limited', () => {
    render(<GenerateView {...defaultProps} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
