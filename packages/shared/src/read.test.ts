import { describe, it, expect } from "vitest";
import {
  CefrLevel,
  WordFlagSchema,
  FlaggedMapSchema,
  READ_TEXT_MAX_CHARS,
  READ_CEFR_TOP_RANK,
  DeepWordCardSchema,
  DeepPhraseCardSchema,
  DeepSentenceCardSchema,
  DeepCardSchema,
  SpanAnnotationsSchema,
  ReadingTextLength,
  READING_GEN_TOPIC_MAX_CHARS,
  READING_LENGTH_WORD_TARGETS,
  READING_TOO_HARD_THRESHOLD,
  READING_CHIPS_BY_LANGUAGE,
} from "./index";
import type {
  WordFlag,
  DeepWordCard,
  DeepPhraseCard,
  DeepSentenceCard,
} from "./index";

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const validFlag: WordFlag = {
  lemma: "aldea",
  pos: "f. noun",
  gloss: "small village, hamlet",
  example: "una aldea de pescadores — a fishing village",
  freq: 5630,
  cefr: CefrLevel.B2,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("READ_TEXT_MAX_CHARS", () => {
  it("is exactly 2000", () => {
    expect(READ_TEXT_MAX_CHARS).toBe(2000);
  });
});

describe("READ_CEFR_TOP_RANK", () => {
  it("is monotonic A1 → C2", () => {
    expect(READ_CEFR_TOP_RANK[CefrLevel.A1]).toBeLessThan(READ_CEFR_TOP_RANK[CefrLevel.A2]);
    expect(READ_CEFR_TOP_RANK[CefrLevel.A2]).toBeLessThan(READ_CEFR_TOP_RANK[CefrLevel.B1]);
    expect(READ_CEFR_TOP_RANK[CefrLevel.B1]).toBeLessThan(READ_CEFR_TOP_RANK[CefrLevel.B2]);
    expect(READ_CEFR_TOP_RANK[CefrLevel.B2]).toBeLessThan(READ_CEFR_TOP_RANK[CefrLevel.C1]);
    expect(READ_CEFR_TOP_RANK[CefrLevel.C1]).toBeLessThan(READ_CEFR_TOP_RANK[CefrLevel.C2]);
  });

  it("covers every CefrLevel", () => {
    expect(Object.keys(READ_CEFR_TOP_RANK)).toEqual(Object.values(CefrLevel));
  });
});

// ---------------------------------------------------------------------------
// WordFlagSchema
// ---------------------------------------------------------------------------

describe("WordFlagSchema", () => {
  it("rejects an empty object", () => {
    expect(WordFlagSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a valid WordFlag", () => {
    const result = WordFlagSchema.safeParse(validFlag);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validFlag);
    }
  });

  it("accepts a WordFlag without `example` (slim skim card)", () => {
    const { example: _omitted, ...slim } = validFlag;
    const result = WordFlagSchema.safeParse(slim);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.example).toBeUndefined();
    }
  });

  it("rejects an empty `lemma` string", () => {
    const bad = { ...validFlag, lemma: "" };
    expect(WordFlagSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a negative `freq`", () => {
    const bad = { ...validFlag, freq: -1 };
    expect(WordFlagSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a non-CEFR `cefr` value", () => {
    const bad: Record<string, unknown> = { ...validFlag, cefr: "Z9" };
    expect(WordFlagSchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FlaggedMapSchema
// ---------------------------------------------------------------------------

describe("FlaggedMapSchema", () => {
  it("round-trips a single-entry map", () => {
    const input = { aldea: validFlag };
    const result = FlaggedMapSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aldea).toEqual(validFlag);
    }
  });

  it("rejects an empty key", () => {
    const input = { "": validFlag };
    expect(FlaggedMapSchema.safeParse(input).success).toBe(false);
  });

  it("accepts an empty map", () => {
    expect(FlaggedMapSchema.parse({})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Deep-card fixtures
// ---------------------------------------------------------------------------

// Minimal word card — only the always-required core fields (Req 6.1).
const validWordCard: DeepWordCard = {
  type: "word",
  surface: "aldeas",
  lemma: "aldea",
  pos: "f. noun",
  contextualSense: "the small fishing villages described in the passage",
  definition: "pueblo muy pequeño, normalmente en el campo",
  definitionLabel: "Español",
  cefr: CefrLevel.B2,
  freq: 5630,
};

// Word card exercising every optional section (Req 6.2–6.4, 7.1).
const fullWordCard: DeepWordCard = {
  ...validWordCard,
  inflection: { forms: [{ label: "plural", value: "aldeas" }] },
  morphology: {
    root: "aldea",
    rootGloss: "village",
    segments: [{ morph: "-s", function: "plural" }],
    whyThisForm: "plural because it refers to several villages",
  },
  synonyms: [{ word: "pueblo", note: "more general" }],
  collocations: [{ phrase: "aldea de pescadores", gloss: "fishing village" }],
  register: "neutral",
  extraExample: { tl: "Vivía en una aldea remota.", en: "She lived in a remote village." },
};

const validPhraseCard: DeepPhraseCard = {
  type: "phrase",
  surface: "echar de menos",
  literal: "to throw of less",
  idiomaticMeaning: "to miss (someone or something)",
  register: "neutral, everyday",
};

const validSentenceCard: DeepSentenceCard = {
  type: "sentence",
  surface: "Echo de menos a mi familia.",
  translation: "I miss my family.",
  breakdown: [
    { chunk: "Echo de menos", role: "verb phrase", note: "idiom meaning 'to miss'" },
    { chunk: "a mi familia", role: "direct object", note: "personal 'a' before people" },
  ],
  grammarNotes: ["personal 'a'", "idiomatic verb phrase"],
};

// ---------------------------------------------------------------------------
// Deep card schemas — individual shapes
// ---------------------------------------------------------------------------

describe("DeepWordCardSchema", () => {
  it("parses the minimal core-fields fixture", () => {
    expect(DeepWordCardSchema.safeParse(validWordCard).success).toBe(true);
  });

  it("parses a card populated with every optional section", () => {
    const result = DeepWordCardSchema.safeParse(fullWordCard);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(fullWordCard);
    }
  });

  it("rejects a card missing a required core field", () => {
    const { definition: _omitted, ...bad } = validWordCard;
    expect(DeepWordCardSchema.safeParse(bad).success).toBe(false);
  });
});

describe("DeepPhraseCardSchema", () => {
  it("parses a valid fixture", () => {
    expect(DeepPhraseCardSchema.safeParse(validPhraseCard).success).toBe(true);
  });

  it("parses with optional citation, example, and synonyms", () => {
    const withOptional: DeepPhraseCard = {
      ...validPhraseCard,
      citation: "echar de menos",
      example: { tl: "Te echo de menos.", en: "I miss you." },
      synonyms: [{ phrase: "extrañar", note: "Latin American" }],
    };
    expect(DeepPhraseCardSchema.safeParse(withOptional).success).toBe(true);
  });

  it("rejects a card missing the idiomatic meaning", () => {
    const { idiomaticMeaning: _omitted, ...bad } = validPhraseCard;
    expect(DeepPhraseCardSchema.safeParse(bad).success).toBe(false);
  });
});

describe("DeepSentenceCardSchema", () => {
  it("parses a valid fixture", () => {
    const result = DeepSentenceCardSchema.safeParse(validSentenceCard);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.breakdown).toHaveLength(2);
    }
  });

  it("rejects a card missing the translation", () => {
    const { translation: _omitted, ...bad } = validSentenceCard;
    expect(DeepSentenceCardSchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DeepCardSchema — discriminated union on `type`
// ---------------------------------------------------------------------------

describe("DeepCardSchema", () => {
  it("discriminates each card type via `type`", () => {
    const word = DeepCardSchema.safeParse(validWordCard);
    const phrase = DeepCardSchema.safeParse(validPhraseCard);
    const sentence = DeepCardSchema.safeParse(validSentenceCard);
    expect(word.success && word.data.type).toBe("word");
    expect(phrase.success && phrase.data.type).toBe("phrase");
    expect(sentence.success && sentence.data.type).toBe("sentence");
  });

  it("rejects an object with no `type` discriminator", () => {
    const { type: _omitted, ...noType } = validWordCard;
    expect(DeepCardSchema.safeParse(noType).success).toBe(false);
  });

  it("rejects an unknown `type`", () => {
    const bad = { ...validWordCard, type: "clause" };
    expect(DeepCardSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a fixture whose fields don't match its declared `type`", () => {
    // Word fields under a "phrase" discriminator: phrase requires literal/
    // idiomaticMeaning/register, which the word card lacks.
    const mismatched = { ...validWordCard, type: "phrase" };
    expect(DeepCardSchema.safeParse(mismatched).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SpanAnnotationsSchema — "start:end" → DeepCard map
// ---------------------------------------------------------------------------

describe("SpanAnnotationsSchema", () => {
  it("round-trips a span-keyed deep card", () => {
    const input = { "12:21": validWordCard };
    const result = SpanAnnotationsSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["12:21"]).toEqual(validWordCard);
    }
  });

  it("accepts an empty map", () => {
    expect(SpanAnnotationsSchema.parse({})).toEqual({});
  });

  it("rejects an entry whose value is not a valid DeepCard", () => {
    const input = { "0:5": { type: "word", surface: "x" } };
    expect(SpanAnnotationsSchema.safeParse(input).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reading generation constants
// ---------------------------------------------------------------------------

describe("reading generation constants", () => {
  it("defines three length tiers", () => {
    expect(Object.values(ReadingTextLength)).toEqual(["short", "medium", "long"]);
  });

  it("has an ascending word target per length", () => {
    const { short, medium, long } = READING_LENGTH_WORD_TARGETS;
    expect(short.max).toBeLessThanOrEqual(medium.min);
    expect(medium.max).toBeLessThanOrEqual(long.min);
    expect(short.min).toBeGreaterThan(0);
  });

  it("caps the topic length and sets a sane too-hard threshold", () => {
    expect(READING_GEN_TOPIC_MAX_CHARS).toBeGreaterThan(0);
    expect(READING_TOO_HARD_THRESHOLD).toBeGreaterThan(0);
    expect(READING_TOO_HARD_THRESHOLD).toBeLessThan(1);
  });
});

describe("READING_CHIPS_BY_LANGUAGE", () => {
  it("provides at least three chips for each reading language", () => {
    for (const lang of ["ES", "DE", "TR"] as const) {
      expect(READING_CHIPS_BY_LANGUAGE[lang].length).toBeGreaterThanOrEqual(3);
    }
  });
});
