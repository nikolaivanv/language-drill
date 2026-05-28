import { describe, expect, it } from "vitest";
import { detectSentenceRanges, resolveSpanType } from "./read-span-utils.js";

// Offsets are derived via `indexOf` so the tests don't hand-count UTF-16 units.
function range(text: string, sub: string): { start: number; end: number } {
  const start = text.indexOf(sub);
  if (start < 0) throw new Error(`fixture bug: "${sub}" not found`);
  return { start, end: start + sub.length };
}

const ES = "Aunque estaba cansado, siguió trabajando. Se fue a casa.";
const TR = "Çocuklar evlerinden çıktılar.";

describe("resolveSpanType", () => {
  it("classifies a single word as `word`", () => {
    const { start, end } = range(ES, "cansado");
    expect(resolveSpanType(ES, start, end)).toBe("word");
  });

  it("classifies a multi-word non-sentence span as `phrase`", () => {
    const { start, end } = range(ES, "siguió trabajando");
    expect(resolveSpanType(ES, start, end)).toBe("phrase");
  });

  it("classifies a full sentence (with terminal period) as `sentence`", () => {
    const { start, end } = range(ES, "Aunque estaba cansado, siguió trabajando.");
    expect(resolveSpanType(ES, start, end)).toBe("sentence");
  });

  it("classifies a full sentence selected WITHOUT its trailing period as `sentence`", () => {
    const { start, end } = range(ES, "Aunque estaba cansado, siguió trabajando");
    expect(resolveSpanType(ES, start, end)).toBe("sentence");
  });

  it("classifies the second sentence as `sentence`", () => {
    const { start, end } = range(ES, "Se fue a casa.");
    expect(resolveSpanType(ES, start, end)).toBe("sentence");
  });

  it("ignores surrounding whitespace when matching a sentence", () => {
    // Extend the selection one char past the period into the following space.
    const base = range(ES, "Aunque estaba cansado, siguió trabajando.");
    expect(resolveSpanType(ES, base.start, base.end + 1)).toBe("sentence");
  });

  it("treats a one-word sentence as `word` (word-count precedence)", () => {
    const text = "Vino. Llegó tarde.";
    const { start, end } = range(text, "Vino.");
    expect(resolveSpanType(text, start, end)).toBe("word");
  });

  it("classifies a whole single-sentence passage as `sentence`", () => {
    expect(resolveSpanType(TR, 0, TR.length)).toBe("sentence");
  });

  it("classifies a Turkish inflected word as `word`", () => {
    const { start, end } = range(TR, "evlerinden");
    expect(resolveSpanType(TR, start, end)).toBe("word");
  });

  it("classifies a span crossing a sentence boundary as `phrase` (not a single sentence)", () => {
    const { start } = range(ES, "trabajando.");
    const { end } = range(ES, "Se fue");
    expect(resolveSpanType(ES, start, end + "Se fue".length)).toBe("phrase");
  });
});

describe("detectSentenceRanges", () => {
  it("splits on terminal punctuation and yields content-aligned ranges", () => {
    const ranges = detectSentenceRanges(ES);
    expect(ranges).toHaveLength(2);
    expect(ES.slice(ranges[0].start, ranges[0].end)).toBe(
      "Aunque estaba cansado, siguió trabajando.",
    );
    expect(ES.slice(ranges[1].start, ranges[1].end)).toBe("Se fue a casa.");
  });

  it("returns a final range for a trailing fragment with no terminator", () => {
    const text = "Hola. Sin punto final";
    const ranges = detectSentenceRanges(text);
    expect(ranges).toHaveLength(2);
    expect(text.slice(ranges[1].start, ranges[1].end)).toBe("Sin punto final");
  });
});
