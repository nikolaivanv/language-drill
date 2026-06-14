import { describe, it, expect } from 'vitest';
import { reconstructMarked, type MarkedSegment } from './reconstruct';
import type { FreeWritingError } from '@language-drill/shared';

const plain = (segs: MarkedSegment[]) =>
  segs
    .map((s) => ('text' in s ? s.text : 'good' in s ? s.good : s.original))
    .join('');

describe('reconstructMarked', () => {
  const text = 'Si yo tendría la oportunidad, elegiría un modelo híbrido.';

  it('splices a located error and preserves the original text', () => {
    const errors: FreeWritingError[] = [
      { n: 1, severity: 'high', type: 'Modo', original: 'tendría', correction: 'tuviera', note: 'n' },
    ];
    const paras = reconstructMarked(text, errors, []);
    expect(paras).toHaveLength(1);
    expect(plain(paras[0])).toBe(text);
    expect(paras[0].some((s) => 'errorRef' in s && s.errorRef === 1)).toBe(true);
  });

  it('highlights a good span', () => {
    const paras = reconstructMarked(text, [], ['un modelo híbrido']);
    expect(plain(paras[0])).toBe(text);
    expect(paras[0].some((s) => 'good' in s)).toBe(true);
  });

  it('drops a span that is not present without corrupting text', () => {
    const errors: FreeWritingError[] = [
      { n: 1, severity: 'low', type: 'x', original: 'NOT IN TEXT', correction: 'y', note: 'n' },
    ];
    const paras = reconstructMarked(text, errors, []);
    expect(plain(paras[0])).toBe(text);
    expect(paras[0].every((s) => !('errorRef' in s))).toBe(true);
  });

  it('splits on blank lines into multiple paragraphs', () => {
    const multi = 'First para.\n\nSecond para.';
    const paras = reconstructMarked(multi, [], []);
    expect(paras).toHaveLength(2);
    expect(plain(paras[0])).toBe('First para.');
    expect(plain(paras[1])).toBe('Second para.');
  });

  it('handles overlapping spans by taking the first and skipping the overlap', () => {
    const t = 'the quick brown fox';
    const errors: FreeWritingError[] = [
      { n: 1, severity: 'low', type: 'a', original: 'quick brown', correction: 'q', note: 'n' },
      { n: 2, severity: 'low', type: 'b', original: 'brown fox', correction: 'b', note: 'n' },
    ];
    const paras = reconstructMarked(t, errors, []);
    expect(plain(paras[0])).toBe(t);
    const refs = paras[0].filter((s) => 'errorRef' in s);
    expect(refs).toHaveLength(1);
  });
});
