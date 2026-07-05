import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ExerciseType,
  Language,
  type ClozeContent,
} from '@language-drill/shared';

// ExplainWhy (rendered for deterministic results) calls useExplainSubmission,
// a TanStack mutation that would otherwise need a QueryClientProvider; mock
// the hook at module level (same idiom as flag-exercise-control.test.tsx).
const mockExplainMutateAsync = vi.fn();
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return {
    ...actual,
    useExplainSubmission: () => ({
      mutateAsync: mockExplainMutateAsync,
      isPending: false,
      isError: false,
    }),
  };
});

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

const wrongSubmission: SubmissionState = {
  kind: 'evaluated',
  result: {
    score: 0,
    grammarAccuracy: 0,
    vocabularyRange: 'A2',
    taskAchievement: 0,
    feedback: 'not quite',
    errors: [],
    estimatedCefrEvidence: 'A2',
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

// The typeable blank is the sole text input in the idle prompt; query it by role.
function blank(): HTMLInputElement {
  return screen.getByRole('textbox') as HTMLInputElement;
}

describe('ClozeExercise', () => {
  describe('prompt hierarchy', () => {
    it('renders the grammar point (context) as an eyebrow tag', () => {
      renderCloze({
        content: { ...baseContent, context: 'Present-tense regular verbs' },
      });
      expect(
        screen.getByText('Present-tense regular verbs'),
      ).toBeInTheDocument();
    });

    it('omits the grammar eyebrow when context is absent', () => {
      const { context: _ignored, ...noContext } = baseContent;
      void _ignored;
      renderCloze({ content: noContext });
      expect(
        screen.queryByText('Present-tense regular verbs'),
      ).not.toBeInTheDocument();
    });

    it('renders the meaning gloss with a labelled eyebrow', () => {
      renderCloze({
        content: { ...baseContent, glossEn: 'I eat bread every day.' },
      });
      expect(screen.getByText('meaning')).toBeInTheDocument();
      expect(screen.getByText('I eat bread every day.')).toBeInTheDocument();
    });

    it('omits the meaning gloss and its label when glossEn is absent', () => {
      renderCloze();
      expect(screen.queryByText('meaning')).not.toBeInTheDocument();
    });

    it('renders the sentence text around the blank', () => {
      const { container } = renderCloze();
      expect(container.textContent).toContain('Yo');
      expect(container.textContent).toContain('pan todos los días.');
    });
  });

  describe('typeable blank', () => {
    it('renders an inline text input as the blank', () => {
      renderCloze();
      expect(blank()).toBeInTheDocument();
    });

    it('autofocuses the blank on mount', () => {
      renderCloze();
      expect(blank()).toHaveFocus();
    });

    it('disables submit until the blank has input', () => {
      renderCloze();
      expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
    });

    it('submits the typed value with usedMc:false', () => {
      const onSubmit = vi.fn();
      renderCloze({ onSubmit });
      fireEvent.change(blank(), { target: { value: 'como' } });
      const submitBtn = screen.getByRole('button', { name: /submit/i });
      expect(submitBtn).not.toBeDisabled();
      fireEvent.click(submitBtn);
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        'como',
        expect.objectContaining({ usedMc: false }),
      );
    });

    it('submits when Enter is pressed in the blank', () => {
      const onSubmit = vi.fn();
      renderCloze({ onSubmit });
      const el = blank();
      fireEvent.change(el, { target: { value: 'como' } });
      fireEvent.keyDown(el, { key: 'Enter' });
      expect(onSubmit).toHaveBeenCalledWith(
        'como',
        expect.objectContaining({ usedMc: false }),
      );
    });

    it('does not submit on Enter when the blank is empty', () => {
      const onSubmit = vi.fn();
      renderCloze({ onSubmit });
      fireEvent.keyDown(blank(), { key: 'Enter' });
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('inserts an accent character into the blank', () => {
      renderCloze({ language: Language.ES });
      const el = blank();
      fireEvent.change(el, { target: { value: 'com' } });
      fireEvent.click(
        screen.getByRole('button', { name: /insert á/i }),
      );
      expect(el.value).toContain('á');
    });
  });

  describe('options scaffold', () => {
    it('shows the options toggle when options.length >= 2', () => {
      renderCloze();
      expect(screen.getByText(/show answer options/i)).toBeInTheDocument();
    });

    it('hides the toggle when options is undefined', () => {
      const { options: _ignored, ...noOptions } = baseContent;
      void _ignored;
      renderCloze({ content: noOptions });
      expect(screen.queryByText(/show answer options/i)).not.toBeInTheDocument();
    });

    it('hides the toggle when options is an empty array', () => {
      renderCloze({ content: { ...baseContent, options: [] } });
      expect(screen.queryByText(/show answer options/i)).not.toBeInTheDocument();
    });

    it('hides the toggle when options.length === 1', () => {
      renderCloze({ content: { ...baseContent, options: ['como'] } });
      expect(screen.queryByText(/show answer options/i)).not.toBeInTheDocument();
    });

    it('reveals option chips when "show answer options" is clicked', () => {
      renderCloze();
      // No option chips before reveal.
      expect(
        screen.queryByRole('button', { name: 'comes' }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByText(/show answer options/i));
      expect(
        screen.getByRole('button', { name: 'comes' }),
      ).toBeInTheDocument();
    });

    it('fills the blank with the chosen chip and marks usedMc', () => {
      const onSubmit = vi.fn();
      renderCloze({ onSubmit });
      fireEvent.click(screen.getByText(/show answer options/i));
      fireEvent.click(screen.getByRole('button', { name: 'comes' }));
      // The blank now holds the chosen word.
      expect(blank().value).toBe('comes');
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      expect(onSubmit).toHaveBeenCalledWith(
        'comes',
        expect.objectContaining({ usedMc: true }),
      );
    });

    it('keeps usedMc true if the learner reveals options then types their own answer', () => {
      const onSubmit = vi.fn();
      renderCloze({ onSubmit });
      fireEvent.click(screen.getByText(/show answer options/i));
      fireEvent.change(blank(), { target: { value: 'como' } });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      expect(onSubmit).toHaveBeenCalledWith(
        'como',
        expect.objectContaining({ usedMc: true }),
      );
    });
  });

  describe('evaluated state', () => {
    it('renders the FeedbackShell with verdict label, score chip, and feedback body', () => {
      renderCloze({ submission: evaluatedSubmission });
      expect(screen.getByText('close')).toBeInTheDocument();
      expect(screen.getByText('94%')).toBeInTheDocument();
      expect(screen.getByText('almost there')).toBeInTheDocument();
    });

    it('reveals the correct answer regardless of the user score', () => {
      renderCloze({ submission: evaluatedSubmission });
      expect(screen.getByText('correct answer')).toBeInTheDocument();
      expect(screen.getByText('como')).toBeInTheDocument();
    });

    it('lists acceptable alternatives (excluding the correct answer) when present', () => {
      renderCloze({
        content: {
          ...baseContent,
          correctAnswer: 'como',
          acceptableAnswers: ['como', 'tomo'],
        },
        submission: evaluatedSubmission,
      });
      expect(screen.getByText(/also accepted:/i)).toHaveTextContent(
        'also accepted: tomo',
      );
    });

    it('omits the also-accepted line when there are no distinct alternatives', () => {
      renderCloze({
        content: { ...baseContent, acceptableAnswers: ['como'] },
        submission: evaluatedSubmission,
      });
      expect(screen.queryByText(/also accepted:/i)).not.toBeInTheDocument();
    });

    it('renders the scaffolded chip when the learner revealed options before evaluation', () => {
      const { rerender, props } = renderCloze();
      fireEvent.click(screen.getByText(/show answer options/i));
      rerender(<ClozeExercise {...props} submission={evaluatedSubmission} />);
      expect(screen.getByText('scaffolded')).toBeInTheDocument();
    });

    it('disables the blank once evaluated', () => {
      renderCloze({ submission: evaluatedSubmission });
      expect(blank()).toBeDisabled();
    });

    it('marks the blank correct when the score is high', () => {
      renderCloze({ submission: evaluatedSubmission });
      expect(blank()).toHaveAttribute('data-state', 'correct');
    });

    it('marks the blank wrong when the score is low', () => {
      renderCloze({ submission: wrongSubmission });
      expect(blank()).toHaveAttribute('data-state', 'wrong');
    });

    it('applies the ok underline color class after a correct submission', () => {
      renderCloze({ submission: evaluatedSubmission });
      const underline = blank().nextElementSibling;
      expect(underline).toHaveClass('bg-ok');
      expect(underline).not.toHaveClass('bg-accent-2');
    });

    it('applies the accent-2 underline color class after a wrong submission', () => {
      renderCloze({ submission: wrongSubmission });
      const underline = blank().nextElementSibling;
      expect(underline).toHaveClass('bg-accent-2');
      expect(underline).not.toHaveClass('bg-ok');
    });

    it('disables every accent picker chip when evaluated', () => {
      renderCloze({ submission: evaluatedSubmission });
      const chips = screen
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-label')?.startsWith('insert '));
      expect(chips.length).toBeGreaterThan(0);
      chips.forEach((chip) => expect(chip).toBeDisabled());
    });
  });

  describe('Explain why gating (deterministic results)', () => {
    const deterministicSubmission: Extract<SubmissionState, { kind: 'evaluated' }> = {
      kind: 'evaluated',
      result: {
        score: 1,
        grammarAccuracy: 1,
        vocabularyRange: 'B1',
        taskAchievement: 1,
        feedback: 'Correct — como',
        errors: [],
        estimatedCefrEvidence: 'B1',
        evaluationSource: 'deterministic',
      },
      meta: {},
      submissionId: 'sub-1',
    };
    const fetchFn = vi.fn();

    it('renders the Explain why button for a deterministic result with a submissionId', () => {
      renderCloze({
        submission: deterministicSubmission,
        exerciseId: 'ex-1',
        fetchFn,
      });
      expect(
        screen.getByRole('button', { name: /explain why/i }),
      ).toBeInTheDocument();
      // The canned feedback line still shows alongside the button.
      expect(screen.getByText('Correct — como')).toBeInTheDocument();
    });

    it('renders plain feedback (no button) when evaluationSource is llm', () => {
      renderCloze({
        submission: {
          ...deterministicSubmission,
          result: {
            ...deterministicSubmission.result,
            evaluationSource: 'llm',
          },
        },
        exerciseId: 'ex-1',
        fetchFn,
      });
      expect(
        screen.queryByRole('button', { name: /explain why/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('Correct — como')).toBeInTheDocument();
    });

    it('renders plain feedback (no button) when evaluationSource is absent', () => {
      renderCloze({
        submission: evaluatedSubmission,
        exerciseId: 'ex-1',
        fetchFn,
      });
      expect(
        screen.queryByRole('button', { name: /explain why/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('almost there')).toBeInTheDocument();
    });

    it('renders plain feedback (no button) when the submission has no submissionId', () => {
      renderCloze({
        submission: { ...deterministicSubmission, submissionId: undefined },
        exerciseId: 'ex-1',
        fetchFn,
      });
      expect(
        screen.queryByRole('button', { name: /explain why/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('Correct — como')).toBeInTheDocument();
    });
  });

  describe('non-blank fallback', () => {
    it('renders a standalone input when the sentence has no ___ marker', () => {
      renderCloze({ content: { ...baseContent, sentence: 'Hola amigo.' } });
      expect(screen.getByText('Hola amigo.')).toBeInTheDocument();
      expect(screen.getByRole('textbox')).toBeInTheDocument();
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

  describe('answer draft persistence', () => {
    beforeEach(() => window.sessionStorage.clear());

    it('restores a saved draft for its exercise id', () => {
      window.sessionStorage.setItem('drill:draft:ex-9', 'borrowed');
      renderCloze({ exerciseId: 'ex-9' });
      expect(blank()).toHaveValue('borrowed');
    });

    it('persists typing to sessionStorage under the exercise id', () => {
      renderCloze({ exerciseId: 'ex-9' });
      fireEvent.change(blank(), { target: { value: 'como' } });
      expect(window.sessionStorage.getItem('drill:draft:ex-9')).toBe('como');
    });

    it('clears the stored draft on submit', () => {
      renderCloze({ exerciseId: 'ex-9' });
      fireEvent.change(blank(), { target: { value: 'como' } });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      expect(window.sessionStorage.getItem('drill:draft:ex-9')).toBeNull();
    });
  });

  describe('desktop submit alignment', () => {
    it('renders the submit button inside a right-aligned wrapper (justify-end) on desktop', () => {
      const { container } = renderCloze();
      const submitBtn = screen.getByRole('button', { name: /submit/i });
      const wrapper = submitBtn.parentElement;
      expect(wrapper).toHaveClass('justify-end');
      expect(wrapper).toHaveClass('flex');
      // The wrapper should be present in the container
      expect(container.querySelector('.flex.justify-end')).toBeTruthy();
    });

    it('does not render the desktop submit wrapper when active (mobile mode)', () => {
      const { container } = render(
        <DrillActionProvider active>
          <ClozeExercise
            content={baseContent}
            language={Language.ES}
            submission={idleSubmission}
            onSubmit={vi.fn()}
            onNext={vi.fn()}
          />
        </DrillActionProvider>,
      );
      expect(container.querySelector('.flex.justify-end')).toBeNull();
    });
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
      const { onSubmit, getCaptured } = renderActive();
      fireEvent.change(blank(), { target: { value: 'como' } });

      const action = getCaptured();
      expect(action?.label).toBe('submit');
      expect(action?.disabled).toBe(false);

      action?.onClick();
      expect(onSubmit).toHaveBeenCalledWith(
        'como',
        expect.objectContaining({ usedMc: false }),
      );
    });
  });
});
