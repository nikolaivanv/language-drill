import { createHash } from 'node:crypto';

/**
 * Read practice supports ES/DE/TR only (LearningLanguage excludes EN). One
 * deterministic neural Polly voice per language keeps the content-addressed
 * S3 key stable, so the same passage synthesizes exactly once across users.
 */
export type ReadingAudioLanguage = 'ES' | 'DE' | 'TR';

export const READING_VOICE_BY_LANGUAGE: Record<
  ReadingAudioLanguage,
  { voiceId: string; languageCode: string }
> = {
  ES: { voiceId: 'Lucia', languageCode: 'es-ES' },
  DE: { voiceId: 'Vicki', languageCode: 'de-DE' },
  TR: { voiceId: 'Burcu', languageCode: 'tr-TR' },
};

/** Polly SynthesizeSpeech neural billed-char cap. */
export const POLLY_NEURAL_MAX_CHARS = 3000;

/** Trim + collapse all whitespace so trivially different copies share a key. */
export function normalizePassageText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** Content-addressed S3 key: identical (language, voice, text) → identical key. */
export function readingAudioKey(language: string, voiceId: string, normalizedText: string): string {
  const hash = createHash('sha256')
    .update(`${language}|${voiceId}|${normalizedText}`)
    .digest('hex');
  return `reading/${hash}.mp3`;
}

/**
 * Rough duration estimate (~2.5 words/sec neural pace). The client's <audio>
 * element self-corrects to the real duration on load, so this only needs to be
 * a sane initial label.
 */
export function estimateDurationSec(normalizedText: string): number {
  const words = normalizedText.length === 0 ? 0 : normalizedText.split(' ').length;
  return Math.max(1, Math.ceil(words / 2.5));
}
