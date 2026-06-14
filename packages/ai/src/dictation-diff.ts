/**
 * packages/ai — Deterministic dictation diff.
 *
 * The deterministic half of dictation grading ("character-level comparison").
 * Pure: no Claude, no I/O. Produces raw char/word accuracy plus an ordered list
 * of differences, each with a stable id, that the Claude "forgiveness" pass
 * (dictation-eval.ts) then classifies as accepted vs. genuine error.
 */

export type DiffDifference = {
  id: number;
  /** Lowercased, punctuation-trimmed token the learner produced ("" for a deletion). */
  got: string;
  /** Lowercased, punctuation-trimmed reference token ("" for an insertion). */
  expected: string;
};

export type DiffSegment =
  | { kind: "match"; text: string }
  | { kind: "diff"; id: number; got: string; expected: string };

export type DictationDiff = {
  rawCharAccuracy: number;
  wordAccuracy: number;
  /** Ordered prose segments (match runs + diffs) over the reference, for the UI. */
  segments: DiffSegment[];
  differences: DiffDifference[];
};

/** NFC + collapse internal whitespace + trim. Case preserved (case is a real diff). */
function normWhitespace(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Lowercased, NFC, leading/trailing punctuation stripped — for word matching. */
function normToken(t: string): string {
  return t
    .normalize("NFC")
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "");
}

function tokenize(s: string): string[] {
  const trimmed = normWhitespace(s);
  return trimmed.length === 0 ? [] : trimmed.split(" ");
}

/** Levenshtein distance between two strings (characters). */
function charLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

type Op = "equal" | "sub" | "del" | "ins";
type AlignedOp = { op: Op; ref?: string; hyp?: string };

/** Token-level edit script via Levenshtein backtrace. `ref` is expected, `hyp` is typed. */
function alignTokens(refTokens: string[], hypTokens: string[]): AlignedOp[] {
  const refN = refTokens.map(normToken);
  const hypN = hypTokens.map(normToken);
  const m = refN.length;
  const n = hypN.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = refN[i - 1] === hypN[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  const ops: AlignedOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const cost = refN[i - 1] === hypN[j - 1] ? 0 : 1;
      if (d[i][j] === d[i - 1][j - 1] + cost) {
        ops.push({ op: cost === 0 ? "equal" : "sub", ref: refTokens[i - 1], hyp: hypTokens[j - 1] });
        i--; j--;
        continue;
      }
    }
    if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ op: "del", ref: refTokens[i - 1] }); // reference word missing from hyp
      i--;
      continue;
    }
    ops.push({ op: "ins", hyp: hypTokens[j - 1] }); // extra word in hyp
    j--;
  }
  ops.reverse();
  return ops;
}

/**
 * Groups a flat op list into runs of equal vs. non-equal ops.
 * Consecutive non-equal ops are merged into a single error region so that
 * word-boundary merges (e.g. "lo cura" → "locura") count as one difference
 * rather than two independent edits.
 */
type Region =
  | { kind: "equal"; ops: AlignedOp[] }
  | { kind: "diff"; ops: AlignedOp[] };

function groupRegions(ops: AlignedOp[]): Region[] {
  const regions: Region[] = [];
  for (const op of ops) {
    const last = regions[regions.length - 1];
    if (op.op === "equal") {
      if (last?.kind === "equal") {
        last.ops.push(op);
      } else {
        regions.push({ kind: "equal", ops: [op] });
      }
    } else {
      if (last?.kind === "diff") {
        last.ops.push(op);
      } else {
        regions.push({ kind: "diff", ops: [op] });
      }
    }
  }
  return regions;
}

export function diffDictation(reference: string, typed: string): DictationDiff {
  const normRef = normWhitespace(reference);
  const normTyped = normWhitespace(typed);
  const maxLen = Math.max(normRef.length, normTyped.length);
  const rawCharAccuracy = maxLen === 0 ? 1 : 1 - charLevenshtein(normRef, normTyped) / maxLen;

  const refTokens = tokenize(reference);
  const hypTokens = tokenize(typed);
  const ops = alignTokens(refTokens, hypTokens);
  const regions = groupRegions(ops);

  const diffRegions = regions.filter((r) => r.kind === "diff");
  const wordAccuracy =
    refTokens.length === 0
      ? 1
      : Math.max(0, refTokens.length - diffRegions.length) / refTokens.length;

  const segments: DiffSegment[] = [];
  const differences: DiffDifference[] = [];
  let nextId = 1;

  for (const region of regions) {
    if (region.kind === "equal") {
      const text = region.ops.map((o) => o.ref!).join(" ");
      segments.push({ kind: "match", text });
    } else {
      const got = region.ops
        .filter((o) => o.hyp !== undefined)
        .map((o) => normToken(o.hyp!))
        .join(" ");
      const expected = region.ops
        .filter((o) => o.ref !== undefined)
        .map((o) => normToken(o.ref!))
        .join(" ");
      const id = nextId++;
      segments.push({ kind: "diff", id, got, expected });
      differences.push({ id, got, expected });
    }
  }

  return { rawCharAccuracy, wordAccuracy, segments, differences };
}
