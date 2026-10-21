import { describe, expect, it } from 'vitest';

import {
  hasBlank,
  hideWordInExample,
  revealWordInExample,
} from '../example-sentence';

describe('revealWordInExample (post-answer)', () => {
  it('fills a pre-blanked slot with the word', () => {
    expect(revealWordInExample('Mi ___ trabaja todos los días.', 'padre')).toBe(
      'Mi padre trabaja todos los días.',
    );
  });

  it('fills every blank when several are present', () => {
    expect(revealWordInExample('___ y ___ otra vez', 'sí')).toBe('sí y sí otra vez');
  });

  it('leaves a natural sentence that already contains the word untouched', () => {
    const s = 'Her sabah otobüse biniyorum.';
    expect(revealWordInExample(s, 'otobüs')).toBe(s);
  });

  it('is a no-op without a word', () => {
    expect(revealWordInExample('Mi ___ trabaja.', '')).toBe('Mi ___ trabaja.');
  });
});

describe('hideWordInExample (pre-submit hint)', () => {
  it('masks the exact word', () => {
    expect(hideWordInExample('Bu meyve suyu çok tatlı.', 'tatlı')).toBe(
      'Bu meyve suyu çok ___.',
    );
  });

  it('masks an inflected (suffixed) form — the follow-up gap', () => {
    expect(hideWordInExample('Her sabah otobüse biniyorum.', 'otobüs')).toBe(
      'Her sabah ___ biniyorum.',
    );
  });

  it('anchors around words that start with a Turkish letter', () => {
    expect(hideWordInExample('Sabah çayı içiyorum.', 'çay')).toBe(
      'Sabah ___ içiyorum.',
    );
  });

  it('does not mask a word merely embedded mid-token', () => {
    // "el" must not mask "del" (preceded by a letter).
    expect(hideWordInExample('El libro es del niño.', 'el')).toBe(
      '___ libro es del niño.',
    );
  });

  it('leaves an already-blanked sentence unchanged', () => {
    const s = 'Mi ___ trabaja todos los días.';
    expect(hideWordInExample(s, 'padre')).toBe(s);
  });

  it.each([
    ['Der Kellner bringt das Essen an den Tisch.', 'bringen', 'Der Kellner ___ das Essen an den Tisch.'],
    ['Necesito levantarme temprano.', 'levantarse', 'Necesito ___ temprano.'],
    ['Annemi ve babamı çok seviyorum.', 'sevmek', 'Annemi ve babamı çok ___.'],
    ['Annem her akşam yemek pişirir.', 'pişirmek', 'Annem her akşam yemek ___.'],
    ['Ich gehe jeden Morgen in die Küche.', 'gehen', 'Ich ___ jeden Morgen in die Küche.'],
  ])('masks a conjugated verb by its stem: %s', (sentence, word, expected) => {
    expect(hideWordInExample(sentence, word)).toBe(expected);
  });

  it('masks a Turkish consonant-mutated form', () => {
    expect(hideWordInExample('Bu kitabı okudum.', 'kitap')).toBe('Bu ___ okudum.');
  });

  it('masks every word of a multi-word headword', () => {
    expect(hideWordInExample('Filme schauen macht mir viel Spaß.', 'Spaß machen')).toBe(
      'Filme schauen ___ mir viel ___.',
    );
  });

  it('matches a one- or two-letter word only whole', () => {
    expect(hideWordInExample('Voy a la playa con amigos.', 'ir a')).toBe(
      'Voy ___ la playa con amigos.',
    );
  });

  it('leaves a form the stem cannot reach unmasked, so the caller can tell', () => {
    const out = hideWordInExample('Er spricht jeden Abend im Radio.', 'sprechen');
    expect(hasBlank(out)).toBe(false);
  });
});

describe('hasBlank', () => {
  it('detects the generator blank', () => {
    expect(hasBlank('Mi ___ trabaja.')).toBe(true);
    expect(hasBlank('Her sabah otobüse biniyorum.')).toBe(false);
  });
});
