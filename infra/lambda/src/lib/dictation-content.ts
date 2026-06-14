/**
 * Merge a presigned audioUrl into a dictation exercise's contentJson at response
 * time. audioUrl is a derived (non-stored) field on DictationContent.
 */
export function withAudioUrl(contentJson: unknown, audioUrl: string | null): unknown {
  if (audioUrl === null) return contentJson;
  if (contentJson === null || typeof contentJson !== "object") return contentJson;
  return { ...(contentJson as Record<string, unknown>), audioUrl };
}
