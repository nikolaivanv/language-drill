import { ExerciseType, type ExerciseContent } from '@language-drill/shared';

// One graded fluency item, captured by the runner for the debrief.
export type FluencyItemResult = {
  index: number;
  type: string;
  promptLabel: string;
  userAnswer: string;
  correct: boolean;
  correctAnswer: string;
  latencyMs: number;
};

export type FluencySummary = {
  count: number;
  correctCount: number;
  accuracy: number;
  medianLatencyMs: number;
  fastestMs: number;
  slowestMs: number;
};

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function summarizeFluency(results: FluencyItemResult[]): FluencySummary {
  const count = results.length;
  if (count === 0) {
    return {
      count: 0,
      correctCount: 0,
      accuracy: 0,
      medianLatencyMs: 0,
      fastestMs: 0,
      slowestMs: 0,
    };
  }
  const latencies = results.map((r) => r.latencyMs);
  const correctCount = results.filter((r) => r.correct).length;
  return {
    count,
    correctCount,
    accuracy: correctCount / count,
    medianLatencyMs: median(latencies),
    fastestMs: Math.min(...latencies),
    slowestMs: Math.max(...latencies),
  };
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

// A short label for the per-item recap. Fluency only serves cloze, vocab-recall,
// and conjugation; other types never reach here.
export function promptLabelFor(content: ExerciseContent): string {
  if (content.type === ExerciseType.CLOZE) return content.sentence;
  if (content.type === ExerciseType.VOCAB_RECALL) return content.prompt;
  if (content.type === ExerciseType.CONJUGATION) {
    return `${content.lemma} · ${content.featureBundle}`;
  }
  return '';
}
