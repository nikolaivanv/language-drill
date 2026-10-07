/**
 * Lexical-reuse metrics for `eval:gen --pool-history`: do new drafts reuse the
 * cell's over-represented content words (its "hot tokens") and mirror existing
 * stems less once the generator sees the cell's history?
 *
 * Deliberately crude: a 5-character prefix stands in for a lemma (good enough
 * to compare two arms over the same cells in ES/DE/TR/EN, not a linguistic
 * measure), and stopwords are one union list because translation sources are
 * English while cloze stems are target-language. The hot-token list is printed
 * per cell so a reader can see what was counted. Tokens in >= HOT_MAX_SHARE of a
 * cell's stems are excluded as structural (the tested form, e.g. `donde`, or a
 * repeated prompt framing), so only filler (`herma…`, `cafe`) counts as reuse.
 */

export const HOT_MIN_SHARE = 0.15;
export const HOT_MIN_ROWS = 3;
/**
 * Tokens present in >= 80% of a cell's pool stems are structural — the tested
 * form or a repeated prompt framing (e.g. `donde` in every es-b1-relative-clauses
 * row). Every draft is expected to contain them, so counting them as reuse pins
 * that cell near 100% in both arms and biases the pooled verdict toward `inspect`.
 */
export const HOT_MAX_SHARE = 0.8;
export const MIN_TOKEN_LEN = 4;
export const PREFIX_LEN = 5;
/** Ship-ready iff candidate hot-reuse ≤ SHIP_REUSE_RATIO × baseline … */
export const SHIP_REUSE_RATIO = 0.7;
/** … and approval drops by at most this much (absolute, 0.05 = 5pp). */
export const MAX_APPROVAL_DROP = 0.05;

export type HotToken = { token: string; rows: number; share: number };
export type CellReuse = { drafts: number; hotHits: number; jaccardSum: number };
export type ReuseFold = { drafts: number; hotReuseRate: number; meanMaxJaccard: number };
export type ReuseVerdict = "ship-ready" | "inspect" | "inconclusive";

// Matched against the full lowercased, diacritic-stripped word (before
// prefixing). Words under MIN_TOKEN_LEN never reach this list.
const STOPWORDS: ReadonlySet<string> = new Set([
  // EN
  "that", "this", "these", "those", "with", "have", "from", "they", "them", "their",
  "there", "what", "when", "where", "which", "will", "would", "your", "were", "been",
  "about", "into", "some", "than", "then", "very", "just", "said", "also",
  // ES
  "para", "como", "pero", "este", "esta", "esto", "estos", "estas", "ella", "ellas",
  "ellos", "todo", "toda", "todos", "todas", "porque", "cuando", "sobre", "desde",
  "hasta", "entre", "tambien", "siempre", "nunca", "mucho", "mucha", "muchos",
  "nosotros", "vosotros", "usted", "ustedes",
  // DE
  "nicht", "eine", "einen", "einem", "einer", "eines", "dass", "aber", "wenn", "auch",
  "noch", "schon", "sehr", "oder", "sind", "habe", "haben", "wird", "werden", "kann",
  "mein", "meine", "dein", "deine", "sein", "seine", "ihre",
  // TR
  "icin", "gibi", "daha", "olan", "kadar", "sonra", "butun", "bunu", "buna", "onun",
  "benim", "senin",
]);

export function contentTokens(text: string): Set<string> {
  const words =
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{Diacritic}+/gu, "")
      .match(/\p{L}+/gu) ?? [];
  const out = new Set<string>();
  for (const w of words) {
    if (w.length < MIN_TOKEN_LEN || STOPWORDS.has(w)) continue;
    out.add(w.slice(0, PREFIX_LEN));
  }
  return out;
}

export function hotTokens(poolStems: readonly string[]): HotToken[] {
  if (poolStems.length === 0) return [];
  const rows = new Map<string, number>();
  for (const stem of poolStems) {
    for (const t of contentTokens(stem)) rows.set(t, (rows.get(t) ?? 0) + 1);
  }
  const out: HotToken[] = [];
  for (const [token, n] of rows) {
    const share = n / poolStems.length;
    if (n >= HOT_MIN_ROWS && share >= HOT_MIN_SHARE && share < HOT_MAX_SHARE) out.push({ token, rows: n, share });
  }
  return out.sort((a, b) => b.rows - a.rows || a.token.localeCompare(b.token));
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function maxJaccard(draftStem: string, poolStems: readonly string[]): number {
  const d = contentTokens(draftStem);
  let best = 0;
  for (const p of poolStems) best = Math.max(best, jaccard(d, contentTokens(p)));
  return best;
}

export function cellReuse(draftStems: readonly string[], poolStems: readonly string[]): CellReuse {
  const hot = new Set(hotTokens(poolStems).map((h) => h.token));
  let hotHits = 0;
  let jaccardSum = 0;
  for (const stem of draftStems) {
    const tokens = contentTokens(stem);
    if ([...tokens].some((t) => hot.has(t))) hotHits++;
    jaccardSum += maxJaccard(stem, poolStems);
  }
  return { drafts: draftStems.length, hotHits, jaccardSum };
}

/**
 * The part of a stem the reuse metrics measure. An SC stem is
 * `prompt → modelAnswers[0]` (`historyStem`), and the prompt is the English
 * task the learner reads ("Write a sentence using these four words…"). That
 * boilerplate repeats across every row, so measuring it pinned all SC cells at
 * 100% reuse in both arms of the 2026-10-07 run. Measure the answer only;
 * cloze, translation and answer-less SC stems have no " → " and pass through.
 * (Revised after that run — a post-hoc change to the metric, not the rule.)
 */
export function measuredPart(stem: string): string {
  const i = stem.lastIndexOf(" → ");
  return i === -1 ? stem : stem.slice(i + " → ".length);
}

/** Pools drafts across cells (a 30-draft cell weighs 3× a 10-draft cell). */
export function foldReuse(cells: readonly CellReuse[]): ReuseFold {
  let drafts = 0;
  let hotHits = 0;
  let jaccardSum = 0;
  for (const c of cells) {
    drafts += c.drafts;
    hotHits += c.hotHits;
    jaccardSum += c.jaccardSum;
  }
  return drafts === 0
    ? { drafts: 0, hotReuseRate: 0, meanMaxJaccard: 0 }
    : { drafts, hotReuseRate: hotHits / drafts, meanMaxJaccard: jaccardSum / drafts };
}

/**
 * The spec's pre-registered decision rule. `inconclusive` when the baseline
 * shows no hot-token reuse at all — otherwise `0 ≤ 0.7 × 0` would call a
 * no-signal run ship-ready.
 */
export function reuseVerdict(
  baseline: ReuseFold,
  candidate: ReuseFold,
  approvalRateDelta: number,
): ReuseVerdict {
  if (baseline.drafts === 0 || baseline.hotReuseRate === 0) return "inconclusive";
  const reuseFell = candidate.hotReuseRate <= SHIP_REUSE_RATIO * baseline.hotReuseRate;
  const approvalHeld = approvalRateDelta >= -MAX_APPROVAL_DROP - 1e-9;
  return reuseFell && approvalHeld ? "ship-ready" : "inspect";
}
