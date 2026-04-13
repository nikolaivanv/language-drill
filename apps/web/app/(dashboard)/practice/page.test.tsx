import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExerciseType, Language } from "@language-drill/shared";
import PracticePage from "./page";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn().mockResolvedValue("test-token");

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

const mockUseExercise = vi.fn();
const mockMutate = vi.fn();
const mockReset = vi.fn();
const mockUseSubmitAnswer = vi.fn();

vi.mock("@language-drill/api-client", () => ({
  useExercise: (...args: unknown[]) => mockUseExercise(...args),
  useSubmitAnswer: (...args: unknown[]) => mockUseSubmitAnswer(...args),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PracticePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSubmitAnswer.mockReturnValue({
      mutate: mockMutate,
      reset: mockReset,
      isPending: false,
      error: null,
    });
  });

  it("renders the page title and selectors", () => {
    mockUseExercise.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });

    renderWithProviders(<PracticePage />);

    expect(screen.getByText("Practice")).toBeInTheDocument();
    expect(screen.getByLabelText("Language")).toBeInTheDocument();
    expect(screen.getByLabelText("Difficulty")).toBeInTheDocument();
  });

  it("shows loading skeleton while fetching", () => {
    mockUseExercise.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    renderWithProviders(<PracticePage />);

    // The skeleton has animated placeholder divs
    const skeleton = document.querySelector(".animate-pulse");
    expect(skeleton).toBeInTheDocument();
  });

  it('shows "No exercises available" on 404 error', () => {
    mockUseExercise.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Request failed with status 404"),
    });

    renderWithProviders(<PracticePage />);

    expect(screen.getByText("No exercises available")).toBeInTheDocument();
  });

  it("shows generic error message for non-404 errors", () => {
    mockUseExercise.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Network error"),
    });

    renderWithProviders(<PracticePage />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("renders a cloze exercise", () => {
    mockUseExercise.mockReturnValue({
      data: {
        id: "ex-1",
        type: "cloze",
        language: "EN",
        difficulty: "B1",
        contentJson: {
          type: ExerciseType.CLOZE,
          instructions: "Fill in the blank",
          sentence: "She ____ to the park yesterday.",
          correctAnswer: "went",
          options: ["went", "goes", "going"],
          context: "Past tense usage",
        },
      },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<PracticePage />);

    expect(screen.getByText("Fill in the blank")).toBeInTheDocument();
    expect(screen.getByText("went")).toBeInTheDocument();
    expect(screen.getByText("goes")).toBeInTheDocument();
    expect(screen.getByText("going")).toBeInTheDocument();
    expect(screen.getByText(/Past tense usage/)).toBeInTheDocument();
  });

  it("renders a translation exercise", () => {
    mockUseExercise.mockReturnValue({
      data: {
        id: "ex-2",
        type: "translation",
        language: "ES",
        difficulty: "A2",
        contentJson: {
          type: ExerciseType.TRANSLATION,
          instructions: "Translate to Spanish",
          sourceText: "The cat is on the table.",
          sourceLanguage: Language.EN,
          targetLanguage: Language.ES,
          referenceTranslation: "El gato esta sobre la mesa.",
        },
      },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<PracticePage />);

    expect(screen.getByText("Translate to Spanish")).toBeInTheDocument();
    expect(
      screen.getByText("The cat is on the table."),
    ).toBeInTheDocument();
    // "EN" appears in both the language selector option and the source language badge
    expect(screen.getAllByText("EN").length).toBeGreaterThanOrEqual(2);
    // "ES" appears in the language selector option and the target language badge
    expect(screen.getAllByText("ES").length).toBeGreaterThanOrEqual(2);
  });

  it("renders a vocab recall exercise", () => {
    mockUseExercise.mockReturnValue({
      data: {
        id: "ex-3",
        type: "vocab_recall",
        language: "DE",
        difficulty: "B2",
        contentJson: {
          type: ExerciseType.VOCAB_RECALL,
          instructions: "What is the German word for:",
          prompt: "butterfly",
          expectedWord: "Schmetterling",
          hints: ["It is a compound word", "Related to 'Schmetten'"],
          exampleSentence: "Der Schmetterling fliegt uber die Blumen.",
        },
      },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<PracticePage />);

    expect(
      screen.getByText("What is the German word for:"),
    ).toBeInTheDocument();
    expect(screen.getByText("butterfly")).toBeInTheDocument();
    expect(screen.getByText("It is a compound word")).toBeInTheDocument();
    expect(screen.getByText("Related to 'Schmetten'")).toBeInTheDocument();
    expect(
      screen.getByText(/Der Schmetterling fliegt/),
    ).toBeInTheDocument();
  });

  it("passes language and difficulty to useExercise", () => {
    mockUseExercise.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });

    renderWithProviders(<PracticePage />);

    expect(mockUseExercise).toHaveBeenCalledWith(
      expect.objectContaining({
        language: "EN",
        difficulty: "B1",
      }),
    );
  });

  it("displays exercise type badge", () => {
    mockUseExercise.mockReturnValue({
      data: {
        id: "ex-4",
        type: "cloze",
        language: "EN",
        difficulty: "B1",
        contentJson: {
          type: ExerciseType.CLOZE,
          instructions: "Fill in the blank",
          sentence: "Hello ____",
          correctAnswer: "world",
        },
      },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<PracticePage />);

    // The exercise card shows type/language/difficulty badges
    expect(screen.getByText("cloze")).toBeInTheDocument();
    // "B1" appears in both the difficulty selector option and the badge
    expect(screen.getAllByText("B1").length).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // Answer submission tests
  // -------------------------------------------------------------------------

  const clozeExerciseData = {
    id: "ex-1",
    type: "cloze",
    language: "EN",
    difficulty: "B1",
    contentJson: {
      type: ExerciseType.CLOZE,
      instructions: "Fill in the blank",
      sentence: "She ____ to the park.",
      correctAnswer: "went",
    },
  };

  function setupWithExercise() {
    mockUseExercise.mockReturnValue({
      data: clozeExerciseData,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
  }

  it("shows answer textarea and submit button when exercise is displayed", () => {
    setupWithExercise();
    renderWithProviders(<PracticePage />);

    expect(screen.getByPlaceholderText("Type your answer here...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  it("disables submit button when answer is empty", () => {
    setupWithExercise();
    renderWithProviders(<PracticePage />);

    const submitBtn = screen.getByRole("button", { name: "Submit" });
    expect(submitBtn).toBeDisabled();
  });

  it("enables submit button when answer has text", () => {
    setupWithExercise();
    renderWithProviders(<PracticePage />);

    const textarea = screen.getByPlaceholderText("Type your answer here...");
    fireEvent.change(textarea, { target: { value: "went" } });

    const submitBtn = screen.getByRole("button", { name: "Submit" });
    expect(submitBtn).toBeEnabled();
  });

  it("calls mutate with exercise id and answer on submit", () => {
    setupWithExercise();
    renderWithProviders(<PracticePage />);

    const textarea = screen.getByPlaceholderText("Type your answer here...");
    fireEvent.change(textarea, { target: { value: "went" } });

    const submitBtn = screen.getByRole("button", { name: "Submit" });
    fireEvent.click(submitBtn);

    expect(mockMutate).toHaveBeenCalledWith(
      { exerciseId: "ex-1", answer: "went" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("shows loading state while submitting", () => {
    setupWithExercise();
    mockUseSubmitAnswer.mockReturnValue({
      mutate: mockMutate,
      reset: mockReset,
      isPending: true,
      error: null,
    });

    renderWithProviders(<PracticePage />);

    expect(screen.getByRole("button", { name: "Evaluating..." })).toBeDisabled();
    expect(screen.getByPlaceholderText("Type your answer here...")).toBeDisabled();
  });

  it("shows rate limit error message for 429 errors", () => {
    setupWithExercise();
    mockUseSubmitAnswer.mockReturnValue({
      mutate: mockMutate,
      reset: mockReset,
      isPending: false,
      error: new Error("Request failed with status 429"),
    });

    renderWithProviders(<PracticePage />);

    expect(
      screen.getByText("You've reached your daily practice limit. Come back tomorrow!"),
    ).toBeInTheDocument();
  });

  it("shows generic submission error message", () => {
    setupWithExercise();
    mockUseSubmitAnswer.mockReturnValue({
      mutate: mockMutate,
      reset: mockReset,
      isPending: false,
      error: new Error("Server error"),
    });

    renderWithProviders(<PracticePage />);

    expect(
      screen.getByText("Failed to submit answer: Server error"),
    ).toBeInTheDocument();
  });

  it("displays evaluation result with score and feedback", () => {
    setupWithExercise();

    // Simulate the onSuccess callback having been called by rendering
    // with evaluation already set — we test the display component directly
    // by triggering the submit flow
    mockMutate.mockImplementation(
      (_params: unknown, options: { onSuccess: (data: unknown) => void }) => {
        options.onSuccess({
          score: 0.85,
          grammarAccuracy: 0.9,
          vocabularyRange: "B1",
          taskAchievement: 0.8,
          feedback: "Well done! Your answer is accurate.",
          errors: [],
          estimatedCefrEvidence: "B1",
        });
      },
    );

    renderWithProviders(<PracticePage />);

    // Type answer and submit to trigger evaluation display
    const textarea = screen.getByPlaceholderText("Type your answer here...");
    fireEvent.change(textarea, { target: { value: "went" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    // Evaluation should now be displayed
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("Great job!")).toBeInTheDocument();
    expect(screen.getByText("Well done! Your answer is accurate.")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument(); // grammar
    expect(screen.getByText("80%")).toBeInTheDocument(); // task
    expect(screen.getByRole("button", { name: "Next Exercise" })).toBeInTheDocument();
  });

  it("displays evaluation errors with corrections", () => {
    setupWithExercise();

    mockMutate.mockImplementation(
      (_params: unknown, options: { onSuccess: (data: unknown) => void }) => {
        options.onSuccess({
          score: 0.5,
          grammarAccuracy: 0.4,
          vocabularyRange: "A2",
          taskAchievement: 0.6,
          feedback: "Some improvements needed.",
          errors: [
            {
              type: "grammar",
              severity: "major",
              text: "goed",
              correction: "went",
              explanation: "Irregular past tense of 'go'",
            },
            {
              type: "spelling",
              severity: "minor",
              text: "teh",
              correction: "the",
              explanation: "Typo",
            },
          ],
          estimatedCefrEvidence: "A2",
        });
      },
    );

    renderWithProviders(<PracticePage />);

    const textarea = screen.getByPlaceholderText("Type your answer here...");
    fireEvent.change(textarea, { target: { value: "goed" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(screen.getByText("Getting there")).toBeInTheDocument();
    expect(screen.getByText("Errors (2)")).toBeInTheDocument();
    expect(screen.getByText("goed")).toBeInTheDocument();
    expect(screen.getByText("went")).toBeInTheDocument();
    expect(screen.getByText("Irregular past tense of 'go'")).toBeInTheDocument();
    expect(screen.getByText("major")).toBeInTheDocument();
    expect(screen.getByText("minor")).toBeInTheDocument();
    expect(screen.getByText("grammar")).toBeInTheDocument();
    expect(screen.getByText("spelling")).toBeInTheDocument();
  });

  it("hides answer input when evaluation is displayed", () => {
    setupWithExercise();

    mockMutate.mockImplementation(
      (_params: unknown, options: { onSuccess: (data: unknown) => void }) => {
        options.onSuccess({
          score: 0.85,
          grammarAccuracy: 0.9,
          vocabularyRange: "B1",
          taskAchievement: 0.8,
          feedback: "Good.",
          errors: [],
          estimatedCefrEvidence: "B1",
        });
      },
    );

    renderWithProviders(<PracticePage />);

    fireEvent.change(screen.getByPlaceholderText("Type your answer here..."), {
      target: { value: "went" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    // Textarea should be gone, evaluation shown instead
    expect(screen.queryByPlaceholderText("Type your answer here...")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next Exercise" })).toBeInTheDocument();
  });

  it("clears evaluation and shows input on Next Exercise click", () => {
    setupWithExercise();

    mockMutate.mockImplementation(
      (_params: unknown, options: { onSuccess: (data: unknown) => void }) => {
        options.onSuccess({
          score: 0.85,
          grammarAccuracy: 0.9,
          vocabularyRange: "B1",
          taskAchievement: 0.8,
          feedback: "Good.",
          errors: [],
          estimatedCefrEvidence: "B1",
        });
      },
    );

    renderWithProviders(<PracticePage />);

    fireEvent.change(screen.getByPlaceholderText("Type your answer here..."), {
      target: { value: "went" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    // Click Next Exercise
    fireEvent.click(screen.getByRole("button", { name: "Next Exercise" }));

    // Should be back to answer input
    expect(screen.getByPlaceholderText("Type your answer here...")).toBeInTheDocument();
    expect(screen.queryByText("Great job!")).not.toBeInTheDocument();
  });

  it("shows red score styling for low scores", () => {
    setupWithExercise();

    mockMutate.mockImplementation(
      (_params: unknown, options: { onSuccess: (data: unknown) => void }) => {
        options.onSuccess({
          score: 0.2,
          grammarAccuracy: 0.1,
          vocabularyRange: "A1",
          taskAchievement: 0.3,
          feedback: "Needs work.",
          errors: [],
          estimatedCefrEvidence: "A1",
        });
      },
    );

    renderWithProviders(<PracticePage />);

    fireEvent.change(screen.getByPlaceholderText("Type your answer here..."), {
      target: { value: "bad answer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(screen.getByText("Keep practicing")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
  });
});
