export type ConfusionPair = { a: string; b: string };

const CONFUSION_PATTERN =
  /([\p{L}]+)(?:\s*\/\s*|\s+(?:vs\.?|or)\s+)([\p{L}]+)/gu;

const MAX_RESULTS = 3;

export function parseConfusions(feedback: string): ConfusionPair[] {
  const seen = new Set<string>();
  const result: ConfusionPair[] = [];

  for (const match of feedback.matchAll(CONFUSION_PATTERN)) {
    const a = match[1];
    const b = match[2];
    const key = [a.toLowerCase(), b.toLowerCase()].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ a, b });
    if (result.length >= MAX_RESULTS) break;
  }

  return result;
}
