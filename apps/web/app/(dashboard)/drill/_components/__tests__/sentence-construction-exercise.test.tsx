import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ExerciseType,
  Language,
  type SentenceConstructionContent,
} from '@language-drill/shared';
import {
  SentenceConstructionExercise,
  type SentenceConstructionExerciseProps,
  type SubmissionState,
} from '../sentence-construction-exercise';

const baseContent: SentenceConstructionContent = {
  type: ExerciseType.SENTENCE_CONSTRUCTION,
  instructions: 'Write one sentence in Spanish.',
  promptMode: 'keywords',
  prompt: 'Use these words: ayer, biblioteca, libro.',
  keywords: ['ayer', 'biblioteca', 'libro'],
  modelAnswers: [
    'Ayer olvidé un libro en la biblioteca.',
    'Ayer fui a la biblioteca por un libro.',
  ],
};

const idleSubmission: SubmissionState = { kind: 'idle' };

const evaluatedSubmission: SubmissionState = {
  kind: 'evaluated',
  result: {
    score: 0.82,
    grammarAccuracy: 0.85,
    vocabularyRange: 'B1',
    taskAchievement: 0.85,
    feedback: 'good sentence',
    errors: [],
    estimatedCefrEvidence: 'B1',
  },
  meta: {},
};

function renderEx(overrides: Partial<SentenceConstructionExerciseProps> = {}) {
  const props: SentenceConstructionExerciseProps = {
    content: baseContent,
    language: Language.ES,
    submission: idleSubmission,
    onSubmit: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<SentenceConstructionExercise {...props} />) };
}

describe('SentenceConstructionExercise — answer draft', () => {
  beforeEach(() => window.sessionStorage.clear());
  it('restores a saved draft for its exercise id', () => {
    window.sessionStorage.setItem('drill:draft:ex-9', 'mi frase');
    renderEx({ exerciseId: 'ex-9' });
    expect(screen.getByRole('textbox')).toHaveValue('mi frase');
  });
});

describe('SentenceConstructionExercise', () => {
  describe('idle rendering', () => {
    it('renders the instructions text', () => {
      renderEx();
      expect(
        screen.getByText('Write one sentence in Spanish.'),
      ).toBeInTheDocument();
    });

    it('renders the prompt text', () => {
      renderEx();
      expect(
        screen.getByText('Use these words: ayer, biblioteca, libro.'),
      ).toBeInTheDocument();
    });

    it('strips leaked markdown emphasis from the prompt (renders plain text)', () => {
      renderEx({
        content: {
          ...baseContent,
          prompt:
            'Use all four of these words in one sentence: **tú**, **poder**, **ayudar**, **mañana**.',
        },
      });
      expect(
        screen.getByText(
          'Use all four of these words in one sentence: tú, poder, ayudar, mañana.',
        ),
      ).toBeInTheDocument();
      // The raw asterisks must not survive into the DOM.
      expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
    });

    it('strips leaked markdown emphasis from the instructions', () => {
      renderEx({
        content: {
          ...baseContent,
          instructions: 'Write **one** sentence in Spanish.',
        },
      });
      expect(
        screen.getByText('Write one sentence in Spanish.'),
      ).toBeInTheDocument();
    });

    it('renders keyword chips when promptMode is keywords', () => {
      renderEx();
      expect(screen.getByText('ayer')).toBeInTheDocument();
      expect(screen.getByText('biblioteca')).toBeInTheDocument();
      expect(screen.getByText('libro')).toBeInTheDocument();
    });

    it('does not render keyword chips for non-keyword modes', () => {
      renderEx({
        content: {
          ...baseContent,
          promptMode: 'grammar_target',
          prompt: 'Write a sentence using the present subjunctive.',
          keywords: undefined,
          targetStructure: 'present subjunctive',
        },
      });
      // chips would be individual words; 'ayer' should not appear
      expect(screen.queryByText('ayer')).not.toBeInTheDocument();
    });

    it('renders the target structure hint when present', () => {
      renderEx({
        content: {
          ...baseContent,
          promptMode: 'grammar_target',
          keywords: undefined,
          targetStructure: 'present subjunctive',
        },
      });
      expect(
        screen.getByText(/structure: present subjunctive/),
      ).toBeInTheDocument();
    });

    it('shows the "show an example" button initially', () => {
      renderEx();
      expect(
        screen.getByRole('button', { name: /show an example/i }),
      ).toBeInTheDocument();
    });

    it('renders the submit button', () => {
      renderEx();
      expect(
        screen.getByRole('button', { name: /submit/i }),
      ).toBeInTheDocument();
    });
  });

  describe('submit behaviour', () => {
    it('submits the typed sentence with hintCount 0 when no example shown', () => {
      const onSubmit = vi.fn();
      renderEx({ onSubmit });
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'Ayer dejé un libro en la biblioteca.' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      expect(onSubmit).toHaveBeenCalledWith(
        'Ayer dejé un libro en la biblioteca.',
        expect.objectContaining({ hintCount: 0 }),
      );
    });

    it('submits with hintCount 1 when the example was revealed first', () => {
      const onSubmit = vi.fn();
      renderEx({ onSubmit });
      fireEvent.click(screen.getByRole('button', { name: /show an example/i }));
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'Ayer fui a la biblioteca.' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      expect(onSubmit).toHaveBeenCalledWith(
        'Ayer fui a la biblioteca.',
        expect.objectContaining({ hintCount: 1 }),
      );
    });

    it('does not call onSubmit when the textarea is empty', () => {
      const onSubmit = vi.fn();
      renderEx({ onSubmit });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('example reveal', () => {
    it('reveals the first model answer when "show an example" is clicked', () => {
      renderEx();
      fireEvent.click(screen.getByRole('button', { name: /show an example/i }));
      expect(
        screen.getByText(/Ayer olvidé un libro en la biblioteca\./),
      ).toBeInTheDocument();
    });

    it('hides the "show an example" button after revealing', () => {
      renderEx();
      fireEvent.click(screen.getByRole('button', { name: /show an example/i }));
      expect(
        screen.queryByRole('button', { name: /show an example/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('lock state', () => {
    it('marks the textarea as readOnly, disabled, and dimmed once evaluated', () => {
      const { container } = renderEx({ submission: evaluatedSubmission });
      const textarea = container.querySelector(
        'textarea',
      ) as HTMLTextAreaElement | null;
      expect(textarea).not.toBeNull();
      expect(textarea).toHaveAttribute('readonly');
      expect(textarea).toBeDisabled();
      expect(textarea).toHaveClass('opacity-60');
    });

    it('disables the "show an example" button while submitting', () => {
      const { submission } = {
        submission: { kind: 'submitting' } as SubmissionState,
      };
      renderEx({ submission });
      const exampleBtn = screen.getByRole('button', {
        name: /show an example/i,
      });
      expect(exampleBtn).toBeDisabled();
    });
  });

  describe('evaluated state — feedback', () => {
    it('renders the score chip and example answers card', () => {
      renderEx({ submission: evaluatedSubmission });
      expect(screen.getByText('82%')).toBeInTheDocument();
      expect(screen.getByText('example answers')).toBeInTheDocument();
      expect(
        screen.getByText('Ayer olvidé un libro en la biblioteca.'),
      ).toBeInTheDocument();
    });

    it("renders the evaluator's feedback prose", () => {
      renderEx({ submission: evaluatedSubmission });
      expect(screen.getByText('good sentence')).toBeInTheDocument();
    });
  });

  describe('accent picker', () => {
    it('renders accent chips for ES', () => {
      renderEx({ language: Language.ES });
      const chips = screen
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-label')?.startsWith('insert '));
      expect(chips.length).toBeGreaterThan(0);
    });
  });
});

describe('SentenceConstructionExercise — Cmd/Ctrl+Enter submits', () => {
  it('keeps plain Enter as a newline, but submits on Ctrl+Enter', () => {
    const onSubmit = vi.fn();
    renderEx({ onSubmit, submission: { kind: 'idle' } });
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'mi frase nueva' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
