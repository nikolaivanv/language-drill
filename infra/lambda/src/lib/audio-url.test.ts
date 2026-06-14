import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { presignAudioUrl } from './audio-url';

describe('presignAudioUrl', () => {
  const prev = process.env.CONTENT_BUCKET_NAME;
  beforeEach(() => {
    process.env.CONTENT_BUCKET_NAME = 'test-bucket';
    process.env.AWS_ACCESS_KEY_ID = 'x';
    process.env.AWS_SECRET_ACCESS_KEY = 'y';
    process.env.AWS_REGION = 'eu-central-1';
  });
  afterEach(() => { process.env.CONTENT_BUCKET_NAME = prev; });

  it('returns null for a null/empty key', async () => {
    expect(await presignAudioUrl(null)).toBeNull();
    expect(await presignAudioUrl('')).toBeNull();
  });

  it('returns a URL string for a key', async () => {
    const url = await presignAudioUrl('dictation/abc.mp3');
    expect(typeof url).toBe('string');
    expect(url).toContain('dictation/abc.mp3');
  });

  it('returns null when the bucket env is unset', async () => {
    delete process.env.CONTENT_BUCKET_NAME;
    expect(await presignAudioUrl('dictation/abc.mp3')).toBeNull();
  });
});
