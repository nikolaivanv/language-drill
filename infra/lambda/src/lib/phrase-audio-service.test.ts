import { describe, it, expect, vi } from 'vitest';
import { phraseAudioKey } from '@language-drill/db';
import { resolvePhraseAudio, type PhraseAudioDeps } from './phrase-audio-service';

type Spoken = Awaited<ReturnType<PhraseAudioDeps['loadSpoken']>>;

function makeDeps(overrides: Partial<PhraseAudioDeps> & { spoken?: Spoken } = {}): PhraseAudioDeps {
  const spoken: Spoken =
    overrides.spoken === undefined ? { text: 'Yarın okula gidiyorum.', language: 'TR' } : overrides.spoken;
  return {
    loadSpoken: vi.fn(async () => spoken),
    countRecentTts: vi.fn(async () => 0),
    limit: vi.fn(() => 100),
    headObjectExists: vi.fn(async () => false),
    synthesize: vi.fn(async () => {}),
    recordTtsUsage: vi.fn(async () => {}),
    presign: vi.fn(async () => 'https://signed/url'),
    ...overrides,
  };
}

describe('resolvePhraseAudio', () => {
  it('not_found when loadSpoken returns null', async () => {
    const deps = makeDeps({ spoken: null });
    expect(await resolvePhraseAudio('s1', 'u1', deps)).toEqual({ kind: 'not_found' });
    expect(deps.synthesize).not.toHaveBeenCalled();
    expect(deps.recordTtsUsage).not.toHaveBeenCalled();
  });

  it('HeadObject hit → no synth, no usage row, presigned url', async () => {
    const deps = makeDeps({ headObjectExists: vi.fn(async () => true) });
    const res = await resolvePhraseAudio('s1', 'u1', deps);
    expect(deps.synthesize).not.toHaveBeenCalled();
    expect(deps.recordTtsUsage).not.toHaveBeenCalled();
    expect(deps.countRecentTts).not.toHaveBeenCalled();
    expect(res).toEqual({ kind: 'ok', audioUrl: 'https://signed/url', durationSec: expect.any(Number) });
  });

  it('miss under cap → synth with the voice for the language + one usage row', async () => {
    const deps = makeDeps();
    const res = await resolvePhraseAudio('s1', 'u1', deps);
    const key = phraseAudioKey('TR', 'Burcu', 'Yarın okula gidiyorum.');
    expect(deps.synthesize).toHaveBeenCalledWith({
      text: 'Yarın okula gidiyorum.',
      key,
      voiceId: 'Burcu',
      languageCode: 'tr-TR',
    });
    expect(deps.recordTtsUsage).toHaveBeenCalledTimes(1);
    expect(deps.recordTtsUsage).toHaveBeenCalledWith('u1', 's1');
    expect(deps.presign).toHaveBeenCalledWith(key);
    expect(res.kind).toBe('ok');
  });

  it('miss at cap → rate_limited, no synth', async () => {
    const deps = makeDeps({ countRecentTts: vi.fn(async () => 100) });
    expect(await resolvePhraseAudio('s1', 'u1', deps)).toEqual({ kind: 'rate_limited' });
    expect(deps.synthesize).not.toHaveBeenCalled();
    expect(deps.recordTtsUsage).not.toHaveBeenCalled();
  });
});
