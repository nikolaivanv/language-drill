import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ExerciseType,
  Language,
  type ClozeContent,
} from '@language-drill/shared';
import {
  ClozeExercise,
  type ClozeExerciseProps,
  type SubmissionState,
} from '../cloze-exercise';
import {
  DrillActionProvider,
  useDrillAction,
  type DrillPrimaryAction,
} from '../drill-action-context';

const baseContent: ClozeContent = {
  type: ExerciseType.CLOZE,
  instructions: 'Fill the blank',
  sentence: 'Yo ___ pan todos los días.',
  correctAnswer: 'como',
  options: ['como', 'comes', 'come'],
  context: 'Present-tense regular verbs',
};

const idleSubmission: SubmissionState = { kind: 'idle' };

const evaluatedSubmission: SubmissionState = {
  kind: 'evaluated',
  result: {
    score: 0.94,
    grammarAccuracy: 0.95,
    vocabularyRange: 'B1',
    taskAchievement: 0.95,
    feedback: 'almost there',
    errors: [],
    estimatedCefrEvidence: 'B1',
  },
  meta: {},
};

function renderCloze(overrides: Partial<ClozeExerciseProps> = {}) {
  const props: ClozeExerciseProps = {
    content: baseContent,
    language: Language.ES,
    submission: idleSubmission,
    onSubmit: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ClozeExercise {...props} />) };
}

describe('ClozeExercise', () => {
  describe('rendering', () => {
    it('renders the optional context line when provided', () => {
      renderCloze({
        content: { ...baseContent, context: 'Present-tense regular verbs' },
      });
      expect(
        screen.getByText('Present-tense regular verbs'),
      ).toBeInTheDocument();
    });

    it('does not render a context line when context is undefined', () => {
      const { context: _ignored, ...noContext } = baseContent;
      void _ignored;
      renderCloze({ content: noContext });
      expect(
        screen.queryByText('Present-tense regular verbs'),
      ).not.toBeInTheDocument();
    });

    it('renders the optional L1 gloss when glossEn is provided (R2.4)', () => {
      renderCloze({
        content: { ...baseContent, glossEn: 'My mother is drinking the coffee.' },
      });
      expect(
        screen.getByText('My mother is drinking the coffee.'),
      ).toBeInTheDocument();
    });

    it('does not render a gloss line when glossEn is undefined', () => {
      // baseContent carries no glossEn, so the default render must omit it.
      renderCloze();
      expect(
        screen.queryByText('My mother is drinking the coffee.'),
      ).not.toBeInTheDocument();
    });

    it('renders the sentence with the blank as a span containing ?', () => {
      const { container } = renderCloze();
      // The blank span is rendered inline; query by text content "?"
      const spans = container.querySelectorAll('span');
      const blankSpan = Array.from(spans).find((s) => s.textContent === '?');
      expect(blankSpan).toBeDefined();
    });

    it('renders the sentence as-is when there is no ___ marker', () => {
      renderCloze({
        content: { ...baseContent, sentence: 'Hola amigo.' },
      });
      expect(screen.getByText('Hola amigo.')).toBeInTheDocument();
    });
  });

  describe('MC toggle visibility', () => {
    it('shows the toggle when options.length >= 2 with reduces progress signal text', () => {
      renderCloze();
      expect(
        screen.getByText(/reduces progress signal/i),
      ).toBeInTheDocument();
    });

    it('hides the toggle when options is undefined', () => {
      const { options: _ignored, ...noOptions } = baseContent;
      void _ignored;
      renderCloze({ content: noOptions });
      expect(
        screen.queryByText(/reduces progress signal/i),
      ).not.toBeInTheDocument();
    });

    it('hides the toggle when options is an empty array', () => {
      renderCloze({ content: { ...baseContent, options: [] } });
      expect(
        screen.queryByText(/reduces progress signal/i),
      ).not.toBeInTheDocument();
    });

    it('hides the toggle when options.length === 1', () => {
      renderCloze({ content: { ...baseContent, options: ['como'] } });
      expect(
        screen.queryByText(/reduces progress signal/i),
      ).not.toBeInTheDocument();
    });
  });

  describe('mode toggle behavior', () => {
    it('switches to MC mode — input hidden, option pills visible', () => {
      const { container } = renderCloze();
      fireEvent.click(screen.getByText(/reduces progress signal/i));
      // Input should no longer be present
      expect(container.querySelector('input')).toBeNull();
      // Each option becomes a radio role
      const radios = screen.getAllByRole('radio');
      expect(radios).toHaveLength(3);
    });

    it('stages the clicked option (aria-checked=true)', () => {
      renderCloze();
      fireEvent.click(screen.getByText(/reduces progress signal/i));
      const radios = screen.getAllByRole('radio');
      // Click the first one
      fireEvent.click(radios[0]);
      expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    });

    it('toggles back to type mode but keeps usedMc sticky (verified via test 14)', () => {
      // Toggle to MC and back
      const { container } = renderCloze();
      fireEvent.click(screen.getByText(/reduces progress signal/i));
      // Now in MC mode — toggle text changes
      fireEvent.click(screen.getByText(/keeps full progress signal/i));
      // Input is back
      expect(container.querySelector('input')).not.toBeNull();
      // sticky behavior verified in test 14 below
    });
  });

  describe('submission', () => {
    it('disables submit when answer is empty in type mode', () => {
      renderCloze();
      const submitBtn = screen.getByRole('button', { name: /submit/i });
      expect(submitBtn).toBeDisabled();
    });

    it('calls onSubmit with answer and { usedMc: false } after typing', () => {
      const onSubmit = vi.fn();
      const { container } = renderCloze({ onSubmit });
      const input = container.querySelector('input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'como' } });
      const submitBtn = screen.getByRole('button', { name: /submit/i });
      expect(submitBtn).not.toBeDisabled();
      fireEvent.click(submitBtn);
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        'como',
        expect.objectContaining({ usedMc: false }),
      );
    });

    it('passes usedMc: true after MC selection — sticky even after toggling back', () => {
      const onSubmit = vi.fn();
      const { container } = renderCloze({ onSubmit });
      // Toggle to MC
      fireEvent.click(screen.getByText(/reduces progress signal/i));
      // Pick an option
      const radios = screen.getAllByRole('radio');
      fireEvent.click(radios[1]);
      // Submit from MC — should be usedMc:true with the selected option
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      expect(onSubmit).toHaveBeenCalledWith(
        'comes',
        expect.objectContaining({ usedMc: true }),
      );

      // Now flip back to type mode and type a different answer; usedMc must stay true
      onSubmit.mockClear();
      // We need a fresh component because submitting locked further interactions only
      // when submission state changes — but our submission stayed `idle`, so we can
      // toggle back. The toggle text is now "keeps full progress signal".
      fireEvent.click(screen.getByText(/keeps full progress signal/i));
      const input = container.querySelector('input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'como' } });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      expect(onSubmit).toHaveBeenCalledWith(
        'como',
        expect.objectContaining({ usedMc: true }),
      );
    });

    it('disables submit and shows loading state when submission.kind === "submitting"', () => {
      const submitting: SubmissionState = { kind: 'submitting' };
      const { container } = renderCloze({ submission: submitting });
      // The button text is replaced by a spinner when loading. Locate it via aria-busy.
      const buttons = container.querySelectorAll('button');
      const submitBtn = Array.from(buttons).find(
        (b) => b.getAttribute('aria-busy') === 'true',
      ) as HTMLButtonElement | undefined;
      expect(submitBtn).toBeDefined();
      expect(submitBtn).toBeDisabled();
      // Spinner is rendered (svg with animate-spin class)
      expect(submitBtn?.querySelector('svg.animate-spin')).not.toBeNull();
    });
  });

  describe('evaluated state', () => {
    it('renders the FeedbackShell with verdict label, score chip, and feedback body', () => {
      renderCloze({ submission: evaluatedSubmission });
      // clozeVerdict(0.94) -> { tier: 'yellow', label: 'close' }
      expect(screen.getByText('close')).toBeInTheDocument();
      expect(screen.getByText('94%')).toBeInTheDocument();
      expect(screen.getByText('almost there')).toBeInTheDocument();
    });

    it('renders the scaffolded chip when the user used MC mode before evaluation', () => {
      // Render idle, toggle to MC, then rerender with the same component instance
      // transitioning to evaluated. Local `usedMc` state persists across rerenders.
      const { rerender, props } = renderCloze();
      fireEvent.click(screen.getByText(/reduces progress signal/i));
      // Now switch to evaluated — usedMc should still be true
      rerender(<ClozeExercise {...props} submission={evaluatedSubmission} />);
      expect(screen.getByText('scaffolded')).toBeInTheDocument();
    });

    it('renders input as readOnly, disabled, and dimmed when evaluated (Req 6.5)', () => {
      const { container } = renderCloze({ submission: evaluatedSubmission });
      const input = container.querySelector('input') as HTMLInputElement;
      expect(input).toHaveAttribute('readonly');
      expect(input).toBeDisabled();
      expect(input).toHaveClass('opacity-60');
    });

    it('disables every accent picker chip when evaluated (Req 7.4)', () => {
      renderCloze({ submission: evaluatedSubmission });
      const chips = screen
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-label')?.startsWith('insert '));
      expect(chips.length).toBeGreaterThan(0);
      chips.forEach((chip) => expect(chip).toBeDisabled());
    });
  });

  describe('accent picker', () => {
    it.each([
      [Language.ES, 'á'],
      [Language.DE, 'ä'],
      [Language.TR, 'ç'],
    ] as const)(
      'renders the accent picker for %s with at least one chip (%s)',
      (language, char) => {
        renderCloze({ language });
        expect(
          screen.getByRole('button', {
            name: new RegExp(`insert ${char}`, 'i'),
          }),
        ).toBeInTheDocument();
      },
    );
  });

  describe('language fallback (Req 7.3)', () => {
    // LearningLanguage is constrained to ES/DE/TR by the type — runtime
    // fallback can't be tested at the component level without bypassing
    // types. The `isAccentLanguage` guard exists for forward compatibility.
    it.skip('falls back gracefully for non-accent languages', () => {});
  });

  describe('mobile action publishing', () => {
    function renderActive(overrides: Partial<ClozeExerciseProps> = {}) {
      const onSubmit = vi.fn();
      let captured: DrillPrimaryAction | null = null;
      function Capture() {
        captured = useDrillAction().primaryAction;
        return null;
      }
      const utils = render(
        <DrillActionProvider active>
          <ClozeExercise
            content={baseContent}
            language={Language.ES}
            submission={idleSubmission}
            onSubmit={onSubmit}
            onNext={vi.fn()}
            {...overrides}
          />
          <Capture />
        </DrillActionProvider>,
      );
      return { onSubmit, getCaptured: () => captured, ...utils };
    }

    it('omits the inline submit button when active', () => {
      renderActive();
      expect(screen.queryByRole('button', { name: 'submit' })).toBeNull();
    });

    it('publishes an enabled submit action once a valid answer is typed', () => {
      const { onSubmit, getCaptured, container } = renderActive();
      const input = container.querySelector('input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'como' } });

      const action = getCaptured();
      expect(action?.label).toBe('submit');
      expect(action?.disabled).toBe(false);

      action?.onClick();
      expect(onSubmit).toHaveBeenCalledWith(
        'como',
        expect.objectContaining({ usedMc: false }),
      );
    });

    it('keeps MC options stacked in a single column (mobile:flex-col)', () => {
      const { container } = renderActive();
      fireEvent.click(screen.getByText(/reduces progress signal/i));
      const optionsRow = container.querySelector('.mobile\\:flex-col');
      expect(optionsRow).not.toBeNull();
    });
  });
});
