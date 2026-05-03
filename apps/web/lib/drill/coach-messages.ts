import { ExerciseType } from "@language-drill/shared";

export type CoachContext =
  | { kind: "idle"; type: ExerciseType }
  | { kind: "evaluated"; type: ExerciseType; score: number };

type Tier = "praise" | "light" | "encourage" | "reset";

function idleMessage(type: ExerciseType): string {
  switch (type) {
    case ExerciseType.CLOZE:
      return "fill the blank · type it out";
    case ExerciseType.TRANSLATION:
      return "translate the meaning, not every word";
    case ExerciseType.VOCAB_RECALL:
      return "say it from memory";
    default: {
      const _exhaustive: never = type;
      throw new Error(`unknown ExerciseType: ${String(_exhaustive)}`);
    }
  }
}

function tierForScore(score: number): Tier {
  if (score >= 0.95) return "praise";
  if (score >= 0.7) return "light";
  if (score >= 0.4) return "encourage";
  return "reset";
}

function evaluatedMessage(type: ExerciseType, score: number): string {
  const tier = tierForScore(score);
  switch (type) {
    case ExerciseType.CLOZE:
      switch (tier) {
        case "praise":
          return "nailed it · the blank fits cleanly";
        case "light":
          return "almost there · check the form once more";
        case "encourage":
          return "the shape's close · look again at what the sentence is asking";
        case "reset":
          return "this one was tricky · let's reset and pick a fresh angle";
      }
      break;
    case ExerciseType.TRANSLATION:
      switch (tier) {
        case "praise":
          return "the meaning lands · clean work";
        case "light":
          return "meaning's right · a small word slipped";
        case "encourage":
          return "you've got the gist · the grammar drifted in the middle";
        case "reset":
          return "tough sentence · let's come back to it from a softer one";
      }
      break;
    case ExerciseType.VOCAB_RECALL:
      switch (tier) {
        case "praise":
          return "right out of memory · that's the word";
        case "light":
          return "right word · the ending wandered";
        case "encourage":
          return "you reached for something close · the meaning was nearby";
        case "reset":
          return "this word didn't surface yet · we'll see it again soon";
      }
      break;
    default: {
      const _exhaustive: never = type;
      throw new Error(`unknown ExerciseType: ${String(_exhaustive)}`);
    }
  }
  throw new Error(`unknown coach tier for score ${score}`);
}

export function coachMessage(ctx: CoachContext): string {
  switch (ctx.kind) {
    case "idle":
      return idleMessage(ctx.type);
    case "evaluated":
      return evaluatedMessage(ctx.type, ctx.score);
    default: {
      const _exhaustive: never = ctx;
      throw new Error(`unknown CoachContext: ${String(_exhaustive)}`);
    }
  }
}
