import { ExerciseType } from "@language-drill/shared";

/** The parts of a free-writing prompt that decide which essay a learner writes. */
export type FreeWritingPromptSummary = {
  title: string;
  task: string;
  requiredElements: string[];
};

const HISTORY_TASK_MAX_CHARS = 200;

function oneLine(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/gu, " ").trim();
  return s.length > 0 ? s : null;
}

/**
 * Summarize stored or drafted free-writing content. Takes `unknown` because
 * callers pass raw `content_json`; returns null when it is not a free-writing
 * prompt with a usable title and task, so malformed rows are skipped rather
 * than sent to the judge as "undefined".
 */
export function freeWritingSummary(content: unknown): FreeWritingPromptSummary | null {
  if (typeof content !== "object" || content === null) return null;
  const c = content as Record<string, unknown>;
  if (c.type !== ExerciseType.FREE_WRITING) return null;
  const title = oneLine(c.title);
  const task = oneLine(c.task);
  if (title === null || task === null) return null;
  const requiredElements = Array.isArray(c.requiredElements)
    ? c.requiredElements.flatMap((e) => {
        const label =
          typeof e === "object" && e !== null ? oneLine((e as Record<string, unknown>).label) : null;
        return label === null ? [] : [label];
      })
    : [];
  return { title, task, requiredElements };
}

/** One generation-history line: `title — task`, task truncated to 200 chars. */
export function freeWritingHistoryLine(s: FreeWritingPromptSummary): string {
  const task =
    s.task.length > HISTORY_TASK_MAX_CHARS ? `${s.task.slice(0, HISTORY_TASK_MAX_CHARS)}…` : s.task;
  return `${s.title} — ${task}`;
}
