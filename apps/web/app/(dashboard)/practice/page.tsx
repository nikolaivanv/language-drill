"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import {
  Language,
  CefrLevel,
  LANGUAGE_NAMES,
  isClozeContent,
  isTranslationContent,
  isVocabRecallContent,
} from "@language-drill/shared";
import type { ExerciseContent } from "@language-drill/shared";
import {
  useExercise,
  useSubmitAnswer,
  useLanguageProfiles,
  createAuthenticatedFetch,
  type ExerciseResponse,
  type EvaluationResultResponse,
} from "@language-drill/api-client";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-6 w-1/3 rounded bg-gray-200" />
      <div className="h-4 w-2/3 rounded bg-gray-200" />
      <div className="h-24 w-full rounded bg-gray-200" />
      <div className="h-4 w-1/2 rounded bg-gray-200" />
    </div>
  );
}

function NoExercisesMessage() {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-6 text-center text-gray-600">
      <p className="text-lg font-medium">No exercises available</p>
      <p className="mt-1 text-sm">
        Try a different language or difficulty level.
      </p>
    </div>
  );
}

function ErrorMessage({ error }: { error: Error }) {
  const is404 =
    error.message.includes("404") ||
    error.message.toLowerCase().includes("not found");

  if (is404) {
    return <NoExercisesMessage />;
  }

  return (
    <div className="rounded border border-red-200 bg-red-50 p-4 text-red-700">
      <p className="font-medium">Something went wrong</p>
      <p className="mt-1 text-sm">{error.message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exercise type renderers
// ---------------------------------------------------------------------------

function ClozeExercise({ content }: { content: ExerciseContent }) {
  if (!isClozeContent(content)) return null;

  // Replace the blank marker (e.g. "___") with a highlighted span
  const parts = content.sentence.split(/_{2,}/);
  const hasBlank = parts.length > 1;

  return (
    <div className="space-y-4">
      <p className="text-gray-600">{content.instructions}</p>

      <div className="rounded bg-blue-50 p-4 text-lg leading-relaxed">
        {hasBlank ? (
          <>
            {parts[0]}
            <span className="mx-1 inline-block min-w-[4rem] border-b-2 border-blue-500 text-center text-blue-500">
              &nbsp;?&nbsp;
            </span>
            {parts.slice(1).join("")}
          </>
        ) : (
          <span>{content.sentence}</span>
        )}
      </div>

      {content.options && content.options.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-gray-500">Options:</p>
          <div className="flex flex-wrap gap-2">
            {content.options.map((option) => (
              <span
                key={option}
                className="rounded-full border border-gray-300 px-3 py-1 text-sm"
              >
                {option}
              </span>
            ))}
          </div>
        </div>
      )}

      {content.context && (
        <p className="text-sm italic text-gray-500">
          Context: {content.context}
        </p>
      )}
    </div>
  );
}

function TranslationExercise({ content }: { content: ExerciseContent }) {
  if (!isTranslationContent(content)) return null;

  return (
    <div className="space-y-4">
      <p className="text-gray-600">{content.instructions}</p>

      <div className="rounded bg-amber-50 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
          <span className="rounded bg-amber-200 px-2 py-0.5 text-xs font-medium">
            {content.sourceLanguage}
          </span>
          <span>&rarr;</span>
          <span className="rounded bg-green-200 px-2 py-0.5 text-xs font-medium">
            {content.targetLanguage}
          </span>
        </div>
        <p className="text-lg leading-relaxed">{content.sourceText}</p>
      </div>
    </div>
  );
}

function VocabRecallExercise({ content }: { content: ExerciseContent }) {
  if (!isVocabRecallContent(content)) return null;

  return (
    <div className="space-y-4">
      <p className="text-gray-600">{content.instructions}</p>

      <div className="rounded bg-purple-50 p-4">
        <p className="text-lg leading-relaxed">{content.prompt}</p>
      </div>

      {content.hints.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-gray-500">Hints:</p>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-600">
            {content.hints.map((hint, index) => (
              <li key={index}>{hint}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-sm italic text-gray-500">
        Example: {content.exampleSentence}
      </p>
    </div>
  );
}

function ExercisePrompt({ exercise }: { exercise: ExerciseResponse }) {
  const content = exercise.contentJson as ExerciseContent;

  if (!content || typeof content !== "object" || !("type" in content)) {
    return (
      <div className="rounded border border-gray-200 p-4 text-gray-500">
        Unable to display this exercise.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium uppercase text-gray-600">
          {exercise.type}
        </span>
        <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
          {exercise.language}
        </span>
        <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
          {exercise.difficulty}
        </span>
      </div>

      {isClozeContent(content) && <ClozeExercise content={content} />}
      {isTranslationContent(content) && (
        <TranslationExercise content={content} />
      )}
      {isVocabRecallContent(content) && (
        <VocabRecallExercise content={content} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Score helpers
// ---------------------------------------------------------------------------

function scoreColor(score: number) {
  if (score >= 0.7) return { text: "text-green-600", bg: "bg-green-50", border: "border-green-200", ring: "ring-green-500" };
  if (score >= 0.4) return { text: "text-yellow-600", bg: "bg-yellow-50", border: "border-yellow-200", ring: "ring-yellow-500" };
  return { text: "text-red-600", bg: "bg-red-50", border: "border-red-200", ring: "ring-red-500" };
}

function ScoreBadge({ score, label }: { score: number; label: string }) {
  const colors = scoreColor(score);
  return (
    <div className={`rounded-lg border p-3 text-center ${colors.bg} ${colors.border}`}>
      <p className={`text-2xl font-bold ${colors.text}`}>
        {Math.round(score * 100)}%
      </p>
      <p className="mt-1 text-xs text-gray-500">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evaluation display
// ---------------------------------------------------------------------------

function EvaluationDisplay({
  evaluation,
  onNext,
}: {
  evaluation: EvaluationResultResponse;
  onNext: () => void;
}) {
  const overall = scoreColor(evaluation.score);

  return (
    <div className="mt-6 space-y-6">
      {/* Overall score */}
      <div className={`flex items-center gap-4 rounded-lg border p-4 ${overall.bg} ${overall.border}`}>
        <div
          className={`flex h-16 w-16 items-center justify-center rounded-full ring-4 ${overall.ring} bg-white`}
        >
          <span className={`text-xl font-bold ${overall.text}`}>
            {Math.round(evaluation.score * 100)}%
          </span>
        </div>
        <div>
          <p className={`text-lg font-semibold ${overall.text}`}>
            {evaluation.score >= 0.7
              ? "Great job!"
              : evaluation.score >= 0.4
                ? "Getting there"
                : "Keep practicing"}
          </p>
          <p className="text-sm text-gray-600">
            CEFR evidence:{" "}
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-medium">
              {evaluation.estimatedCefrEvidence}
            </span>
          </p>
        </div>
      </div>

      {/* Score breakdown */}
      <div className="grid grid-cols-3 gap-3">
        <ScoreBadge score={evaluation.grammarAccuracy} label="Grammar" />
        <ScoreBadge score={evaluation.taskAchievement} label="Task" />
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
          <p className="text-2xl font-bold text-gray-700">
            {evaluation.vocabularyRange}
          </p>
          <p className="mt-1 text-xs text-gray-500">Vocabulary</p>
        </div>
      </div>

      {/* Feedback */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="mb-2 text-sm font-medium text-gray-500">Feedback</p>
        <p className="text-gray-700">{evaluation.feedback}</p>
      </div>

      {/* Errors */}
      {evaluation.errors.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-500">
            Errors ({evaluation.errors.length})
          </p>
          {evaluation.errors.map((err, i) => (
            <div
              key={i}
              className="rounded-lg border border-gray-200 bg-white p-4"
            >
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    err.severity === "major"
                      ? "bg-red-100 text-red-700"
                      : "bg-yellow-100 text-yellow-700"
                  }`}
                >
                  {err.severity}
                </span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {err.type}
                </span>
              </div>
              <p className="text-sm text-gray-700">
                <span className="text-red-600 line-through">{err.text}</span>
                {" → "}
                <span className="font-medium text-green-600">
                  {err.correction}
                </span>
              </p>
              <p className="mt-1 text-sm text-gray-500">{err.explanation}</p>
            </div>
          ))}
        </div>
      )}

      {/* Next exercise */}
      <button
        onClick={onNext}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700"
      >
        Next Exercise
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Answer input
// ---------------------------------------------------------------------------

function AnswerInput({
  answer,
  onChange,
  onSubmit,
  isSubmitting,
  submitError,
}: {
  answer: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  submitError: Error | null;
}) {
  const isRateLimit =
    submitError?.message.includes("429") ||
    submitError?.message.toLowerCase().includes("rate limit");

  return (
    <div className="mt-6 space-y-3">
      <label className="block text-sm font-medium text-gray-700">
        Your answer
      </label>
      <textarea
        value={answer}
        onChange={(e) => onChange(e.target.value)}
        disabled={isSubmitting}
        rows={3}
        placeholder="Type your answer here..."
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
      />

      {submitError && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {isRateLimit
            ? "You've reached your daily practice limit. Come back tomorrow!"
            : `Failed to submit answer: ${submitError.message}`}
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={isSubmitting || !answer.trim()}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
      >
        {isSubmitting && (
          <svg
            className="h-4 w-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {isSubmitting ? "Evaluating..." : "Submit"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PracticePage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const fetchFn = useMemo(
    () => createAuthenticatedFetch(getToken),
    [getToken],
  );

  const { data: profilesData } = useLanguageProfiles({ fetchFn });
  const profiles = profilesData?.profiles ?? [];

  const [language, setLanguage] = useState<Language>(Language.EN);
  const [difficulty, setDifficulty] = useState<CefrLevel>(CefrLevel.B1);
  const [answer, setAnswer] = useState("");
  const [evaluation, setEvaluation] =
    useState<EvaluationResultResponse | null>(null);

  const initializedRef = useRef(false);
  useEffect(() => {
    if (profiles.length > 0 && !initializedRef.current) {
      initializedRef.current = true;
      const first = profiles[0];
      setLanguage(first.language as Language);
      setDifficulty((first.proficiencyLevel as CefrLevel) ?? CefrLevel.B1);
    }
  }, [profiles]);

  const {
    data: exercise,
    isLoading,
    error,
    refetch,
  } = useExercise({
    language,
    difficulty,
    fetchFn,
  });

  const submitMutation = useSubmitAnswer({ fetchFn });

  const handleSubmit = () => {
    if (!exercise || !answer.trim()) return;
    submitMutation.mutate(
      { exerciseId: exercise.id, answer: answer.trim() },
      {
        onSuccess: (result) => {
          setEvaluation(result);
          setAnswer("");
        },
      },
    );
  };

  const handleNextExercise = () => {
    setEvaluation(null);
    setAnswer("");
    submitMutation.reset();
    refetch();
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Practice</h1>

      <div className="mb-6 flex gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          Language
          <select
            value={language}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "__add") {
                // Reset select to previous value before navigating
                e.target.value = language;
                router.push("/onboarding");
                return;
              }
              const newLang = value as Language;
              setLanguage(newLang);
              // Update difficulty to match the selected profile's proficiency
              const matchingProfile = profiles.find(
                (p) => p.language === newLang,
              );
              if (matchingProfile) {
                setDifficulty(matchingProfile.proficiencyLevel as CefrLevel);
              }
            }}
            className="rounded border border-gray-300 bg-white px-3 py-2"
          >
            {profiles.map((p) => (
              <option key={p.language} value={p.language}>
                {LANGUAGE_NAMES[p.language as Language] ?? p.language}
              </option>
            ))}
            <option value="__add">+ Add language</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          Difficulty
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as CefrLevel)}
            className="rounded border border-gray-300 bg-white px-3 py-2"
          >
            {Object.values(CefrLevel).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isLoading && <LoadingSkeleton />}

      {error && !isLoading && <ErrorMessage error={error} />}

      {exercise && !isLoading && !error && (
        <>
          <ExercisePrompt exercise={exercise} />

          {!evaluation && (
            <AnswerInput
              answer={answer}
              onChange={setAnswer}
              onSubmit={handleSubmit}
              isSubmitting={submitMutation.isPending}
              submitError={submitMutation.error}
            />
          )}

          {evaluation && (
            <EvaluationDisplay
              evaluation={evaluation}
              onNext={handleNextExercise}
            />
          )}
        </>
      )}
    </div>
  );
}
