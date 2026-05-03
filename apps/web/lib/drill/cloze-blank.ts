export function splitClozeSentence(sentence: string): {
  before: string;
  after: string;
  hasBlank: boolean;
} {
  const match = sentence.match(/_{3,}/);
  if (!match || match.index === undefined) {
    return { before: sentence, after: '', hasBlank: false };
  }
  const before = sentence.slice(0, match.index);
  const after = sentence.slice(match.index + match[0].length);
  return { before, after, hasBlank: true };
}
