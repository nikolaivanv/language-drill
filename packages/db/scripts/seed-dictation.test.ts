import { describe, it, expect } from 'vitest';
import { DICTATION_CLIPS, toDictationContent } from './seed-dictation';
import { dictationAudioKey } from '../src/lib/polly-synth';

describe('dictation seed data', () => {
  it('has at least 6 clips, all ES, mostly B2', () => {
    expect(DICTATION_CLIPS.length).toBeGreaterThanOrEqual(6);
    expect(DICTATION_CLIPS.every((c) => c.language === 'ES')).toBe(true);
    expect(DICTATION_CLIPS.some((c) => c.difficulty === 'B2')).toBe(true);
    expect(DICTATION_CLIPS.some((c) => c.difficulty === 'B1')).toBe(true);
  });

  it('every clip key is unique', () => {
    const keys = DICTATION_CLIPS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('toDictationContent builds a valid DictationContent', () => {
    const c = toDictationContent(DICTATION_CLIPS[0]);
    expect(c.type).toBe('dictation');
    expect(c.referenceText.length).toBeGreaterThan(0);
    expect(c.sentences.length).toBeGreaterThan(0);
    expect(c.waveform.length).toBeGreaterThan(0);
    expect(c.referenceText).toBe(c.sentences.join(' '));
  });

  it('dictationAudioKey is deterministic and namespaced', () => {
    expect(dictationAudioKey('abc-id')).toBe('dictation/abc-id.mp3');
  });
});
