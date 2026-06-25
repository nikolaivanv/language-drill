// DORMANT (2026-06): coachMessage() is not called by any live component. Parked for reintroduction alongside coach-rail.tsx and coach-card.tsx.
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
    case ExerciseType.SENTENCE_CONSTRUCTION:
      return "build a full sentence · use the prompt";
    case ExerciseType.DICTATION:
      return "listen · type exactly what you hear";
    case ExerciseType.FREE_WRITING:
      return "write freely · then grade it";
    case ExerciseType.CONJUGATION:
      return "type the correct form · think about the ending";
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
    case ExerciseType.SENTENCE_CONSTRUCTION:
      switch (tier) {
        case "praise":
          return "natural and on target · nice construction";
        case "light":
          return "solid · one small tweak and it's clean";
        case "encourage":
          return "the idea's there · tighten the structure";
        case "reset":
          return "tricky structure · let's build it back up";
      }
      break;
    case ExerciseType.DICTATION:
      switch (tier) {
        case "praise":
          return "clean ear · you caught the linking";
        case "light":
          return "almost · a word boundary blurred";
        case "encourage":
          return "the shape's there · the fast parts ran together";
        case "reset":
          return "tough clip · we'll slow it down next time";
      }
      break;
    case ExerciseType.FREE_WRITING:
      return tier === "praise" || tier === "light"
        ? "strong writing · see what lifted it"
        : "good effort · the corrections will sharpen it";
    case ExerciseType.CONJUGATION:
      switch (tier) {
        case "praise":
          return "exactly right · the form locked in";
        case "light":
          return "right verb · the ending slipped slightly";
        case "encourage":
          return "close · check the suffix pattern for this tense";
        case "reset":
          return "tricky form · let's drill the paradigm";
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
