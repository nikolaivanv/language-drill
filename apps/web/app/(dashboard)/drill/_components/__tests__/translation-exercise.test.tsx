import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ExerciseType,
  Language,
  type EvaluationError,
  type TranslationContent,
} from '@language-drill/shared';
import {
  TranslationExercise,
  type SubmissionState,
  type TranslationExerciseProps,
} from '../translation-exercise';
import {
  DrillActionProvider,
  useDrillAction,
  type DrillPrimaryAction,
} from '../drill-action-context';

function withQueryClient(children: React.ReactNode) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const baseContent: TranslationContent = {
  type: ExerciseType.TRANSLATION,
  instructions: 'Translate to Spanish',
  sourceText: 'I can barely afford it.',
  sourceLanguage: Language.EN,
  targetLanguage: Language.ES,
  referenceTranslation: 'Apenas puedo permitírmelo ahora mismo.',
};

const idleSubmission: SubmissionState = { kind: 'idle' };

const evaluatedSubmission: SubmissionState = {
  kind: 'evaluated',
  result: {
    score: 0.82,
    grammarAccuracy: 0.85,
    vocabularyRange: 'B1',
    taskAchievement: 0.85,
    feedback: 'small issues only',
    errors: [],
    estimatedCefrEvidence: 'B1',
  },
  meta: {},
};

function renderTranslation(overrides: Partial<TranslationExerciseProps> = {}) {
  const props: TranslationExerciseProps = {
    content: baseContent,
    language: Language.ES,
    submission: idleSubmission,
    onSubmit: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };
  return {
    props,
    ...render(withQueryClient(<TranslationExercise {...props} />)),
  };
}

describe('TranslationExercise — answer draft', () => {
  beforeEach(() => window.sessionStorage.clear());
  it('restores a saved draft for its exercise id', () => {
    window.sessionStorage.setItem('drill:draft:ex-9', 'mi borrador');
    renderTranslation({ exerciseId: 'ex-9' });
    expect(screen.getByRole('textbox')).toHaveValue('mi borrador');
  });
});

describe('TranslationExercise', () => {
  describe('idle rendering', () => {
    it('renders the eyebrow with EN -> {language} for ES', () => {
      renderTranslation();
      // The component renders `EN &rarr; ES`, which becomes "EN → ES" (U+2192)
      // in the DOM. Match with a regex tolerant of surrounding whitespace.
      expect(screen.getByText(/EN\s*→\s*ES/)).toBeInTheDocument();
    });

    it('renders the source text as the hero line', () => {
      const { container } = renderTranslation();
      // GlossedText splits on whitespace and emits a mix of plain text and
      // <span class="gloss"> elements; check the visible aggregate text on
      // the source paragraph, now promoted to the hero display scale.
      const sourceParagraph = container.querySelector('p.t-display-m');
      expect(sourceParagraph).not.toBeNull();
      expect(sourceParagraph?.textContent).toContain('I can');
      expect(sourceParagraph?.textContent).toContain('barely');
      expect(sourceParagraph?.textContent).toContain('afford');
    });

    it('appends the topic to the direction eyebrow when topicHint is present', () => {
      renderTranslation({
        content: { ...baseContent, topicHint: 'Numbers and ordinals' },
      });
      expect(screen.getByText(/Numbers and ordinals/)).toBeInTheDocument();
      expect(screen.getByText(/EN\s*→\s*ES/)).toBeInTheDocument();
    });

    it('renders a labelled goal gloss', () => {
      renderTranslation();
      expect(screen.getByText('goal')).toBeInTheDocument();
      expect(screen.getByText(/translate the meaning/i)).toBeInTheDocument();
    });

    it('renders the source token "barely" inside a .gloss span (gloss path active for fixture)', () => {
      const { container } = renderTranslation();
      const glossSpans = container.querySelectorAll('span.gloss');
      const lemmas = Array.from(glossSpans).map((s) => s.textContent ?? '');
      // "barely" and "afford" both have entries in gloss-en; both should be
      // wrapped. The hint test below depends on at least "barely" being present.
      expect(lemmas.some((t) => t.includes('barely'))).toBe(true);
    });
  });

  describe('word hints', () => {
    const hintContent: TranslationContent = {
      type: ExerciseType.TRANSLATION,
      instructions: 'Translate',
      sourceText: 'The students are ready',
      sourceLanguage: Language.EN,
      targetLanguage: Language.TR,
      referenceTranslation: 'Öğrenciler hazır',
    };

    it('fetches once on "need a hint" and reveals a lemma on word click', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        json: async () => ({
          cached: false,
          units: [
            { text: 'The', hintable: false },
            { text: 'students', hintable: true, lemma: 'öğrenci' },
            { text: 'are ready', hintable: true, lemma: 'hazır' },
          ],
        }),
      });
      renderTranslation({
        content: hintContent,
        language: Language.TR,
        exerciseId: 'ex-1',
        fetchFn,
      });
      fireEvent.click(screen.getByRole('button', { name: /need a hint/i }));
      await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
      // hintable word is a button; non-hintable is not
      fireEvent.click(await screen.findByRole('button', { name: 'students' }));
      expect(await screen.findByText('öğrenci')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'The' })).toBeNull();
    });

    it('old gloss/half-reference ladder is gone but full-answer remains', () => {
      renderTranslation({ content: hintContent, language: Language.TR });
      expect(
        screen.queryByRole('button', { name: /show me a hint/i }),
      ).toBeNull();
      expect(
        screen.getByRole('button', { name: /reveal full answer/i }),
      ).toBeInTheDocument();
    });

    it('reveals the full reference translation on "reveal full answer"', () => {
      renderTranslation();
      expect(
        screen.queryByText('Apenas puedo permitírmelo ahora mismo.'),
      ).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole('button', { name: /reveal full answer/i }),
      );
      expect(
        screen.getByText('Apenas puedo permitírmelo ahora mismo.'),
      ).toBeInTheDocument();
    });
  });

  describe('evaluated state — error correction colors (Req 4.4)', () => {
    it('renders a minor-severity correction with the sage class (text-ok)', () => {
      const minorError: EvaluationError = {
        type: 'grammar',
        severity: 'minor',
        text: 'puedo',
        correction: 'puedo permitírmelo',
        explanation: 'object pronoun belongs on the infinitive',
      };
      const submission: SubmissionState = {
        kind: 'evaluated',
        result: {
          ...evaluatedSubmission.result,
          errors: [minorError],
        },
        meta: {},
      };
      renderTranslation({ submission });
      const correctionSpan = screen.getByText('puedo permitírmelo');
      expect(correctionSpan).toHaveClass('text-ok');
      expect(correctionSpan).not.toHaveClass('text-accent-2');
    });

    it('renders a major-severity correction with the terracotta class (text-accent-2)', () => {
      const majorError: EvaluationError = {
        type: 'grammar',
        severity: 'major',
        text: 'puedo afortear',
        correction: 'puedo permitírmelo',
        explanation: 'verb does not exist; use permitirse',
      };
      const submission: SubmissionState = {
        kind: 'evaluated',
        result: {
          ...evaluatedSubmission.result,
          errors: [majorError],
        },
        meta: {},
      };
      renderTranslation({ submission });
      const correctionSpan = screen.getByText('puedo permitírmelo');
      expect(correctionSpan).toHaveClass('text-accent-2');
      expect(correctionSpan).not.toHaveClass('text-ok');
    });
  });

  describe('evaluated state — reference translation (Req 4.5)', () => {
    it('renders the reference translation card with the eyebrow and reference text', () => {
      renderTranslation({ submission: evaluatedSubmission });
      expect(screen.getByText('the version we coded')).toBeInTheDocument();
      expect(
        screen.getByText('Apenas puedo permitírmelo ahora mismo.'),
      ).toBeInTheDocument();
    });

    it("renders the evaluator's feedback prose", () => {
      renderTranslation({ submission: evaluatedSubmission });
      expect(screen.getByText('small issues only')).toBeInTheDocument();
    });
  });

  describe('evaluated state — malformed errors row (NFR Reliability)', () => {
    it('silently skips a row missing `correction` and still renders the verdict + reference', () => {
      // Construct a row that the diff renderer should reject because
      // `correction` is not a string. We deliberately bypass the type to
      // simulate a malformed evaluator response.
      const malformed = {
        type: 'grammar',
        severity: 'minor',
        text: 'puedo',
        // correction intentionally omitted
        explanation: 'malformed row should be skipped',
      } as unknown as EvaluationError;
      const validRow: EvaluationError = {
        type: 'grammar',
        severity: 'major',
        text: 'afortear',
        correction: 'permitir',
        explanation: 'real correction renders normally',
      };
      const submission: SubmissionState = {
        kind: 'evaluated',
        result: {
          ...evaluatedSubmission.result,
          errors: [malformed, validRow],
        },
        meta: {},
      };
      const { container } = renderTranslation({ submission });

      // Verdict (FeedbackShell) still rendered: score 0.82 → translationVerdict
      // returns label "meaning is right · small issues" with chip "82%".
      expect(
        screen.getByText('meaning is right · small issues'),
      ).toBeInTheDocument();
      expect(screen.getByText('82%')).toBeInTheDocument();

      // The valid row's correction is rendered; the malformed row is silently
      // skipped (no list item generated, no marker text).
      expect(screen.getByText('permitir')).toBeInTheDocument();
      expect(
        screen.queryByText('malformed row should be skipped'),
      ).not.toBeInTheDocument();

      // The errors <ul> contains exactly one <li> (the valid row) since the
      // malformed row returns null inside the .map callback.
      const list = container.querySelector('ul');
      expect(list).not.toBeNull();
      expect(list?.querySelectorAll('li')).toHaveLength(1);

      // Reference card still renders.
      expect(screen.getByText('the version we coded')).toBeInTheDocument();
    });
  });

  describe('lock state on evaluated (Req 6.5 + Req 7.4)', () => {
    it('marks the textarea as readOnly, disabled, and dimmed once submission is no longer idle', () => {
      const { container } = renderTranslation({
        submission: evaluatedSubmission,
      });
      const textarea = container.querySelector(
        'textarea',
      ) as HTMLTextAreaElement | null;
      expect(textarea).not.toBeNull();
      expect(textarea).toHaveAttribute('readonly');
      expect(textarea).toBeDisabled();
      expect(textarea).toHaveClass('opacity-60');
    });

    it('disables every accent picker chip once submission is no longer idle', () => {
      renderTranslation({
        submission: evaluatedSubmission,
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
        renderTranslation({ language });
        expect(
          screen.getByRole('button', {
            name: new RegExp(`insert ${char}`, 'i'),
          }),
        ).toBeInTheDocument();
      },
    );
  });

  describe('mobile action publishing', () => {
    function renderActive(overrides: Partial<TranslationExerciseProps> = {}) {
      const onSubmit = vi.fn();
      let captured: DrillPrimaryAction | null = null;
      function Capture() {
        captured = useDrillAction().primaryAction;
        return null;
      }
      const utils = render(
        withQueryClient(
          <DrillActionProvider active>
            <TranslationExercise
              content={baseContent}
              language={Language.ES}
              submission={idleSubmission}
              onSubmit={onSubmit}
              onNext={vi.fn()}
              {...overrides}
            />
            <Capture />
          </DrillActionProvider>,
        ),
      );
      return { onSubmit, getCaptured: () => captured, ...utils };
    }

    it('omits the inline submit button but keeps the "need a hint" button inline', () => {
      renderActive();
      expect(screen.queryByRole('button', { name: 'submit' })).toBeNull();
      expect(
        screen.getByRole('button', { name: /need a hint/i }),
      ).toBeInTheDocument();
    });

    it('publishes the submit action once an answer is typed', () => {
      const { onSubmit, getCaptured } = renderActive();
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'apenas puedo' },
      });
      const action = getCaptured();
      expect(action?.label).toBe('submit');
      expect(action?.disabled).toBe(false);

      action?.onClick();
      expect(onSubmit).toHaveBeenCalledWith(
        'apenas puedo',
        expect.objectContaining({
          hintUsage: { wordsRevealed: 0, fullAnswerRevealed: false },
        }),
      );
    });
  });
});

describe('TranslationExercise — Cmd/Ctrl+Enter submits', () => {
  it('keeps plain Enter as a newline, but submits on Cmd+Enter', () => {
    const onSubmit = vi.fn();
    renderTranslation({ onSubmit, submission: { kind: 'idle' } });
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'apenas puedo permitírmelo' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
