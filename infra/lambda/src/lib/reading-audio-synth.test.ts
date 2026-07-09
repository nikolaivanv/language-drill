import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vitest hoists `vi.mock` factories above all imports, but ordinary `const`
// declarations in this file run *after* the imported module (which triggers
// these mocked imports). `vi.hoisted` lets the factories close over
// initialized values instead of hitting a TDZ ReferenceError.
const { send, synthesizeToS3 } = vi.hoisted(() => ({
  send: vi.fn(),
  synthesizeToS3: vi.fn(),
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = send;
  },
  HeadObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));
vi.mock('@aws-sdk/client-polly', () => ({
  PollyClient: class {},
}));
vi.mock('@language-drill/db', () => ({ synthesizeToS3 }));

import { headObjectExists, synthesizeReadingAudio } from './reading-audio-synth';

beforeEach(() => {
  send.mockReset();
  synthesizeToS3.mockReset();
  process.env.CONTENT_BUCKET_NAME = 'test-bucket';
});
afterEach(() => {
  delete process.env.CONTENT_BUCKET_NAME;
});

describe('headObjectExists', () => {
  it('returns true when the object is present', async () => {
    send.mockResolvedValueOnce({});
    expect(await headObjectExists('reading/abc.mp3')).toBe(true);
  });

  it('returns false on a 404 NotFound', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'NotFound' }));
    expect(await headObjectExists('reading/abc.mp3')).toBe(false);
  });

  it('rethrows non-404 errors', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'AccessDenied' }));
    await expect(headObjectExists('reading/abc.mp3')).rejects.toThrow('boom');
  });
});

describe('synthesizeReadingAudio', () => {
  it('delegates to synthesizeToS3 with the resolved bucket/voice', async () => {
    synthesizeToS3.mockResolvedValueOnce(undefined);
    await synthesizeReadingAudio({
      text: 'Hola mundo',
      key: 'reading/abc.mp3',
      voiceId: 'Lucia',
      languageCode: 'es-ES',
    });
    expect(synthesizeToS3).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'test-bucket',
        key: 'reading/abc.mp3',
        text: 'Hola mundo',
        voiceId: 'Lucia',
        languageCode: 'es-ES',
      }),
    );
  });
});
