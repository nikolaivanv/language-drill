import { describe, it, expect, vi } from 'vitest';
import { resolveReadAudio, type ReadAudioDeps, type ReadAudioEntry } from './read-audio-service';

function makeDeps(overrides: Partial<ReadAudioDeps> & { entry?: ReadAudioEntry | null }): ReadAudioDeps {
  const entry =
    overrides.entry === undefined
      ? { id: 'e1', language: 'ES', text: 'Hola mundo', audioS3Key: null }
      : overrides.entry;
  return {
    loadEntry: vi.fn(async () => entry),
    countRecentTts: vi.fn(async () => 0),
    limit: vi.fn(() => 50),
    headObjectExists: vi.fn(async () => false),
    synthesize: vi.fn(async () => {}),
    recordTtsUsage: vi.fn(async () => {}),
    persistKey: vi.fn(async () => {}),
    presign: vi.fn(async () => 'https://signed/url'),
    ...overrides,
  };
}

describe('resolveReadAudio', () => {
  it('404s when the entry is missing / not owned', async () => {
    const deps = makeDeps({ entry: null });
    expect(await resolveReadAudio('e1', 'u1', deps)).toEqual({ kind: 'not_found' });
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it('synthesizes + meters on a cold cache, then persists the key', async () => {
    const deps = makeDeps({});
    const res = await resolveReadAudio('e1', 'u1', deps);
    expect(deps.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ voiceId: 'Lucia', languageCode: 'es-ES', key: expect.stringMatching(/^reading\//) }),
    );
    expect(deps.recordTtsUsage).toHaveBeenCalledWith('u1', 'e1');
    expect(deps.persistKey).toHaveBeenCalledWith('e1', expect.stringMatching(/^reading\//));
    expect(res).toEqual({ kind: 'ok', audioUrl: 'https://signed/url', durationSec: expect.any(Number) });
  });

  it('skips synth + metering on a cross-user cache hit (HeadObject found)', async () => {
    const deps = makeDeps({ headObjectExists: vi.fn(async () => true) });
    const res = await resolveReadAudio('e1', 'u1', deps);
    expect(deps.synthesize).not.toHaveBeenCalled();
    expect(deps.recordTtsUsage).not.toHaveBeenCalled();
    expect(deps.persistKey).toHaveBeenCalled(); // still records the key on this user's row
    expect(res.kind).toBe('ok');
  });

  it('skips head-object + synth entirely when the row already has a key', async () => {
    const deps = makeDeps({ entry: { id: 'e1', language: 'ES', text: 'Hola mundo', audioS3Key: 'reading/x.mp3' } });
    const res = await resolveReadAudio('e1', 'u1', deps);
    expect(deps.headObjectExists).not.toHaveBeenCalled();
    expect(deps.synthesize).not.toHaveBeenCalled();
    expect(deps.presign).toHaveBeenCalledWith('reading/x.mp3');
    expect(res.kind).toBe('ok');
  });

  it('returns too_long past the char cap without synthesizing', async () => {
    const deps = makeDeps({ entry: { id: 'e1', language: 'ES', text: 'x'.repeat(3001), audioS3Key: null } });
    expect(await resolveReadAudio('e1', 'u1', deps)).toEqual({ kind: 'too_long' });
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it('rate_limits before synth when the daily cap is reached', async () => {
    const deps = makeDeps({ countRecentTts: vi.fn(async () => 50), limit: vi.fn(() => 50) });
    expect(await resolveReadAudio('e1', 'u1', deps)).toEqual({ kind: 'rate_limited' });
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it('404s an unsupported language defensively', async () => {
    const deps = makeDeps({ entry: { id: 'e1', language: 'EN', text: 'hello', audioS3Key: null } });
    expect(await resolveReadAudio('e1', 'u1', deps)).toEqual({ kind: 'not_found' });
  });
});
