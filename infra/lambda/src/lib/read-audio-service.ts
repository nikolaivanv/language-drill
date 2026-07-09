import {
  READING_VOICE_BY_LANGUAGE,
  POLLY_NEURAL_MAX_CHARS,
  normalizePassageText,
  readingAudioKey,
  estimateDurationSec,
  type ReadingAudioLanguage,
} from '@language-drill/db';

export interface ReadAudioEntry {
  id: string;
  language: string;
  text: string;
  audioS3Key: string | null;
}

export interface ReadAudioDeps {
  loadEntry(entryId: string, userId: string): Promise<ReadAudioEntry | null>;
  countRecentTts(userId: string): Promise<number>;
  limit(): number;
  headObjectExists(key: string): Promise<boolean>;
  synthesize(args: { text: string; key: string; voiceId: string; languageCode: string }): Promise<void>;
  recordTtsUsage(userId: string, entryId: string): Promise<void>;
  persistKey(entryId: string, key: string): Promise<void>;
  presign(key: string): Promise<string | null>;
}

export type ReadAudioResult =
  | { kind: 'ok'; audioUrl: string | null; durationSec: number }
  | { kind: 'not_found' }
  | { kind: 'too_long' }
  | { kind: 'rate_limited' };

/**
 * Lazy, content-addressed reading-audio resolution. Ownership is enforced by
 * loadEntry (unknown/cross-user → null → 404). Metering + Polly only happen on
 * a true cache miss; HeadObject hits and already-keyed rows are free.
 */
export async function resolveReadAudio(
  entryId: string,
  userId: string,
  deps: ReadAudioDeps,
): Promise<ReadAudioResult> {
  const entry = await deps.loadEntry(entryId, userId);
  if (!entry) return { kind: 'not_found' };

  const voice = READING_VOICE_BY_LANGUAGE[entry.language as ReadingAudioLanguage];
  if (!voice) return { kind: 'not_found' }; // read practice is ES/DE/TR only

  const normalized = normalizePassageText(entry.text);
  if (normalized.length > POLLY_NEURAL_MAX_CHARS) return { kind: 'too_long' };

  const durationSec = estimateDurationSec(normalized);
  const key = entry.audioS3Key ?? readingAudioKey(entry.language, voice.voiceId, normalized);

  if (!entry.audioS3Key) {
    const exists = await deps.headObjectExists(key);
    if (!exists) {
      const used = await deps.countRecentTts(userId);
      if (used >= deps.limit()) return { kind: 'rate_limited' };
      await deps.synthesize({
        text: normalized,
        key,
        voiceId: voice.voiceId,
        languageCode: voice.languageCode,
      });
      await deps.recordTtsUsage(userId, entryId);
    }
    await deps.persistKey(entryId, key);
  }

  const audioUrl = await deps.presign(key);
  return { kind: 'ok', audioUrl, durationSec };
}
