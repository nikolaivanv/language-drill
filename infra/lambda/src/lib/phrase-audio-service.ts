import {
  READING_VOICE_BY_LANGUAGE,
  estimateDurationSec,
  phraseAudioKey,
} from '@language-drill/db';
import type { SpokenText } from './spoken-text';

export interface PhraseAudioDeps {
  /** Ownership-checked spoken text for a submission; null → 404. */
  loadSpoken(submissionId: string, userId: string): Promise<SpokenText | null>;
  countRecentTts(userId: string): Promise<number>;
  limit(): number;
  headObjectExists(key: string): Promise<boolean>;
  synthesize(args: { text: string; key: string; voiceId: string; languageCode: string }): Promise<void>;
  recordTtsUsage(userId: string, submissionId: string): Promise<void>;
  presign(key: string): Promise<string | null>;
}

export type PhraseAudioResult =
  | { kind: 'ok'; audioUrl: string | null; durationSec: number }
  | { kind: 'not_found' }
  | { kind: 'rate_limited' };

/**
 * Lazy, content-addressed audio for the corrected sentence on a drill result
 * card. Mirrors `resolveReadAudio`: metering + Polly only on a true cache miss.
 * Length is already gated by `spokenTextFor`, and the key is derivable from
 * the text, so nothing is persisted on the history row.
 */
export async function resolvePhraseAudio(
  submissionId: string,
  userId: string,
  deps: PhraseAudioDeps,
): Promise<PhraseAudioResult> {
  const spoken = await deps.loadSpoken(submissionId, userId);
  if (!spoken) return { kind: 'not_found' };

  const voice = READING_VOICE_BY_LANGUAGE[spoken.language];
  const key = phraseAudioKey(spoken.language, voice.voiceId, spoken.text);

  if (!(await deps.headObjectExists(key))) {
    const used = await deps.countRecentTts(userId);
    if (used >= deps.limit()) return { kind: 'rate_limited' };
    await deps.synthesize({
      text: spoken.text,
      key,
      voiceId: voice.voiceId,
      languageCode: voice.languageCode,
    });
    await deps.recordTtsUsage(userId, submissionId);
  }

  const audioUrl = await deps.presign(key);
  return { kind: 'ok', audioUrl, durationSec: estimateDurationSec(spoken.text) };
}
