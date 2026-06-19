import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ExerciseType,
  Language,
  type EvaluationError,
  type VocabRecallContent,
} from '@language-drill/shared';
import {
  VocabExercise,
  type SubmissionState,
  type VocabExerciseProps,
} from '../vocab-exercise';
import {
  DrillActionProvider,
  useDrillAction,
  type DrillPrimaryAction,
} from '../drill-action-context';

const baseContent: VocabRecallContent = {
  type: ExerciseType.VOCAB_RECALL,
  instructions: 'Recall the word from the definition',
  prompt: 'to make good use of an opportunity or resource',
  expectedWord: 'aprovechar',
  hints: [],
  exampleSentence: 'Hay que aprovechar el buen tiempo.',
};

const idleSubmission: SubmissionState = { kind: 'idle' };

function evaluatedAt(
  score: number,
  opts: { errors?: EvaluationError[]; feedback?: string } = {},
): SubmissionState {
  return {
    kind: 'evaluated',
    result: {
      score,
      grammarAccuracy: score,
      vocabularyRange: 'B1',
      taskAchievement: score,
      feedback: opts.feedback ?? '',
      errors: opts.errors ?? [],
      estimatedCefrEvidence: 'B1',
    },
    meta: {},
  };
}

function renderVocab(overrides: Partial<VocabExerciseProps> = {}) {
  const props: VocabExerciseProps = {
    content: baseContent,
    language: Language.ES,
    submission: idleSubmission,
    onSubmit: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<VocabExercise {...props} />) };
}

describe('VocabExercise — answer draft', () => {
  beforeEach(() => window.sessionStorage.clear());
  it('restores a saved draft for its exercise id', () => {
    window.sessionStorage.setItem('drill:draft:ex-9', 'mi palabra');
    renderVocab({ exerciseId: 'ex-9' });
    expect(screen.getByRole('textbox')).toHaveValue('mi palabra');
  });
});

describe('VocabExercise', () => {
  describe('idle rendering (Req 5.1)', () => {
    it('renders the prompt (definition) text inside the prompt card', () => {
      const { container } = renderVocab();
      const promptParagraph = container.querySelector('p.t-display-s');
      expect(promptParagraph).not.toBeNull();
      expect(promptParagraph?.textContent).toBe(baseContent.prompt);
    });

    it('auto-focuses the input on initial mount', () => {
      const { container } = renderVocab();
      const input = container.querySelector('input');
      expect(input).not.toBeNull();
      expect(input).toHaveFocus();
    });
  });

  describe('hint progression (Req 5.2)', () => {
    it('reveals the first letter and advances hintLevel after clicking the L1 hint', () => {
      const { container } = renderVocab();

      // Before click: no `first letter:` line, L1 button enabled.
      expect(screen.queryByText(/^first letter:/)).not.toBeInTheDocument();
      const l1Button = screen.getByRole('button', { name: /^first letter$/i });
      expect(l1Button).not.toBeDisabled();

      // Click L1 — parent advances hintLevel from 0 to 1.
      fireEvent.click(l1Button);

      // The HintRow now renders a `<p>` with `first letter:` followed by a
      // <strong> containing the lowercased first letter of expectedWord.
      // For 'aprovechar' that's 'a'. Query the strong tag directly to avoid
      // cross-matching against 'a' characters elsewhere on the page.
      const strong = container.querySelector('p strong');
      expect(strong).not.toBeNull();
      expect(strong?.textContent).toBe('a');

      // After advance, the L1 button itself is disabled (level !== 0).
      expect(
        screen.getByRole('button', { name: /^first letter$/i }),
      ).toBeDisabled();
      // The L2 button (`letter count`) is now the only enabled hint button.
      expect(
        screen.getByRole('button', { name: /^letter count$/i }),
      ).not.toBeDisabled();
    });
  });

  describe('evaluated state — verdict mapping (Req 5.4, 5.5)', () => {
    it('renders the "exact" sage verdict for score === 1.0', () => {
      renderVocab({ submission: evaluatedAt(1.0) });
      // vocabVerdict(1.0, []) -> { tier: 'sage', label: 'exact' }
      expect(screen.getByText('exact')).toBeInTheDocument();
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('renders "right word · wrong inflection" for score 0.85 + grammar error', () => {
      const grammarError: EvaluationError = {
        type: 'grammar',
        severity: 'minor',
        text: 'aprovecho',
        correction: 'aprovechar',
        explanation: 'wrong conjugation — infinitive expected',
      };
      renderVocab({
        submission: evaluatedAt(0.85, { errors: [grammarError] }),
      });
      // vocabVerdict(0.85, [grammar]) -> yellow / right word · wrong inflection
      expect(
        screen.getByText('right word · wrong inflection'),
      ).toBeInTheDocument();
      expect(screen.getByText('85%')).toBeInTheDocument();
    });
  });

  describe('evaluated state — confusions parsing (Req 8.2, 8.3)', () => {
    it('renders the confusions heading and pair list when feedback parses', () => {
      const { container } = renderVocab({
        submission: evaluatedAt(0.85, {
          feedback: 'You may be confusing casi vs apenas in this context.',
          errors: [
            {
              type: 'vocabulary',
              severity: 'minor',
              text: 'casi',
              correction: 'apenas',
              explanation: 'use apenas for "barely"',
            },
          ],
        }),
      });

      // Eyebrow is rendered.
      expect(screen.getByText('common confusions')).toBeInTheDocument();

      // Exactly one <li> with both words present in the same item.
      const listItems = screen.getAllByRole('listitem');
      expect(listItems).toHaveLength(1);
      expect(listItems[0].textContent).toContain('casi');
      expect(listItems[0].textContent).toContain('apenas');

      // The ↔ separator is wrapped in a span with aria-hidden="true".
      const sep = container.querySelector('li span[aria-hidden="true"]');
      expect(sep).not.toBeNull();
    });

    it('omits the confusions heading and list when feedback has no parseable pairs', () => {
      const { container } = renderVocab({
        submission: evaluatedAt(1.0, {
          feedback: 'Nice try, keep going.',
        }),
      });

      // No confusions eyebrow.
      expect(screen.queryByText('common confusions')).not.toBeInTheDocument();
      // No <ul> in the FeedbackShell body — the only list comes from the
      // confusions block, which is omitted entirely when empty.
      expect(container.querySelector('ul')).toBeNull();
    });
  });

  describe('evaluated state — feedback prose', () => {
    it("renders the evaluator's feedback even when no confusions parse", () => {
      renderVocab({
        submission: evaluatedAt(1.0, { feedback: 'Nice try, keep going.' }),
      });
      expect(screen.getByText('Nice try, keep going.')).toBeInTheDocument();
    });
  });

  describe('lock state on evaluated (Req 6.5 + Req 7.4)', () => {
    it('marks the input as readOnly, disabled, and dimmed once submission is no longer idle', () => {
      const { container } = renderVocab({ submission: evaluatedAt(1.0) });
      const input = container.querySelector('input');
      expect(input).not.toBeNull();
      expect(input).toHaveAttribute('readonly');
      expect(input).toBeDisabled();
      expect(input).toHaveClass('opacity-60');
    });

    it('disables every accent picker chip once submission is no longer idle', () => {
      renderVocab({
        submission: evaluatedAt(1.0),
        language: Language.ES,
      });
      const chips = screen
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-label')?.startsWith('insert '));
      expect(chips.length).toBeGreaterThan(0);
      chips.forEach((chip) => expect(chip).toBeDisabled());
    });
  });

  describe('accent picker — parameterized across ES/DE/TR (Req 7.1)', () => {
    it.each([
      [Language.ES, 'á'],
      [Language.DE, 'ä'],
      [Language.TR, 'ç'],
    ] as const)(
      'renders an accent chip for %s (%s)',
      (language, char) => {
        renderVocab({ language });
        expect(
          screen.getByRole('button', {
            name: new RegExp(`insert ${char}`, 'i'),
          }),
        ).toBeInTheDocument();
      },
    );
  });

  describe('mobile action publishing', () => {
    function renderActive(overrides: Partial<VocabExerciseProps> = {}) {
      const onSubmit = vi.fn();
      let captured: DrillPrimaryAction | null = null;
      function Capture() {
        captured = useDrillAction().primaryAction;
        return null;
      }
      const utils = render(
        <DrillActionProvider active>
          <VocabExercise
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

    it('publishes the submit action once an answer is typed', () => {
      const { onSubmit, getCaptured } = renderActive();
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'aprovechar' },
      });
      const action = getCaptured();
      expect(action?.label).toBe('submit');
      expect(action?.disabled).toBe(false);

      action?.onClick();
      expect(onSubmit).toHaveBeenCalledWith(
        'aprovechar',
        expect.objectContaining({ hintLevel: 0 }),
      );
    });
  });
});

describe('VocabExercise — Enter submits', () => {
  it('submits on plain Enter in the input', () => {
    const onSubmit = vi.fn();
    renderVocab({ onSubmit, submission: { kind: 'idle' } });
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'aprovechar' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('aprovechar', expect.anything());
  });
});
