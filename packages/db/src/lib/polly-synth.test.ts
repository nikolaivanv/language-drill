import { describe, it, expect, vi } from 'vitest';
import { synthesizeToS3, dictationAudioKey } from './polly-synth';

describe('dictationAudioKey', () => {
  it('namespaces the key under dictation/ with an .mp3 suffix', () => {
    expect(dictationAudioKey('abc-id')).toBe('dictation/abc-id.mp3');
  });
});

describe('synthesizeToS3', () => {
  it('synthesizes MP3 via Polly and uploads to S3 with the given language code', async () => {
    const polly = {
      send: vi.fn().mockResolvedValue({
        AudioStream: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
      }),
    };
    const s3 = { send: vi.fn().mockResolvedValue({}) };
    await synthesizeToS3({
      polly: polly as never,
      s3: s3 as never,
      bucket: 'b',
      key: 'dictation/x.mp3',
      text: 'Hola mundo.',
      voiceId: 'Sergio',
      languageCode: 'es-ES',
    });
    const pollyInput = polly.send.mock.calls[0][0].input;
    expect(pollyInput).toMatchObject({
      Engine: 'neural',
      OutputFormat: 'mp3',
      VoiceId: 'Sergio',
      LanguageCode: 'es-ES',
      Text: 'Hola mundo.',
    });
    const s3Input = s3.send.mock.calls[0][0].input;
    expect(s3Input).toMatchObject({ Bucket: 'b', Key: 'dictation/x.mp3', ContentType: 'audio/mpeg' });
    expect(s3Input.Body).toEqual(new Uint8Array([1, 2, 3]));
  });
});
