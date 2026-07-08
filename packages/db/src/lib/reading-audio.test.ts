import { describe, it, expect } from 'vitest';
import {
  READING_VOICE_BY_LANGUAGE,
  POLLY_NEURAL_MAX_CHARS,
  normalizePassageText,
  readingAudioKey,
  estimateDurationSec,
} from './reading-audio';

describe('reading-audio helpers', () => {
  it('has one neural voice per read-supported language', () => {
    expect(Object.keys(READING_VOICE_BY_LANGUAGE).sort()).toEqual(['DE', 'ES', 'TR']);
    expect(READING_VOICE_BY_LANGUAGE.ES.languageCode).toBe('es-ES');
    expect(READING_VOICE_BY_LANGUAGE.DE.languageCode).toBe('de-DE');
    expect(READING_VOICE_BY_LANGUAGE.TR.languageCode).toBe('tr-TR');
  });

  it('caps at 3000 chars', () => {
    expect(POLLY_NEURAL_MAX_CHARS).toBe(3000);
  });

  it('normalizes whitespace and trims', () => {
    expect(normalizePassageText('  hola\n  mundo\t x ')).toBe('hola mundo x');
  });

  it('derives a deterministic content-addressed key', () => {
    const norm = normalizePassageText('Hola mundo');
    const a = readingAudioKey('ES', 'Lucia', norm);
    const b = readingAudioKey('ES', 'Lucia', norm);
    expect(a).toBe(b);
    expect(a).toMatch(/^reading\/[0-9a-f]{64}\.mp3$/);
  });

  it('key varies by voice and by text', () => {
    const norm = normalizePassageText('Hola mundo');
    expect(readingAudioKey('ES', 'Lucia', norm)).not.toBe(readingAudioKey('ES', 'Sergio', norm));
    expect(readingAudioKey('ES', 'Lucia', norm)).not.toBe(
      readingAudioKey('ES', 'Lucia', normalizePassageText('Adios mundo')),
    );
  });

  it('estimates duration from word count (>=1s)', () => {
    expect(estimateDurationSec('')).toBe(1);
    expect(estimateDurationSec(normalizePassageText('uno dos tres cuatro cinco'))).toBe(2); // ceil(5/2.5)
  });
});
