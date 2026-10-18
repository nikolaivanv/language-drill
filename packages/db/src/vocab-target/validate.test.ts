import { describe, expect, it } from 'vitest';
import { deriveTier, validateProposedWord } from './validate';

describe('validateProposedWord', () => {
  it('accepts a well-formed word', () => {
    expect(
      validateProposedWord({
        displayForm: 'la manzana',
        lemma: 'manzana',
        gloss: 'apple',
        exampleSentence: 'Como una manzana roja.',
        pos: 'noun',
      }),
    ).toEqual({
      displayForm: 'la manzana',
      lemma: 'manzana',
      gloss: 'apple',
      exampleSentence: 'Como una manzana roja.',
      pos: 'noun',
    });
  });

  it('rejects a multi-token lemma', () => {
    expect(
      validateProposedWord({
        displayForm: 'buenos días',
        lemma: 'buenos días',
        gloss: 'good morning',
        exampleSentence: 'Buenos días a todos.',
        pos: 'noun',
      }),
    ).toBeNull();
  });

  it('rejects when the example omits the word', () => {
    expect(
      validateProposedWord({
        displayForm: 'la manzana',
        lemma: 'manzana',
        gloss: 'apple',
        exampleSentence: 'Como una pera.',
        pos: 'noun',
      }),
    ).toBeNull();
  });

  it.each([
    ['iyi ki', 'Hava güzel, iyi ki geldin.'],
    ['por eso', 'Llegué tarde, por eso no comí.'],
    ['her gün', 'Her gün okuyorum.'],
    ['ab und zu', 'Ab und zu gehe ich ins Kino.'],
    ['o sea', 'No vino, o sea, se quedó en casa.'],
    ['¿qué tal?', 'Hola, ¿qué tal?'],
    ['¿qué tal?', 'Hola, qué tal, Ana.'],
  ])('keeps the all-short-token phrase %s when the example contains it', (lemma, exampleSentence) => {
    expect(
      validateProposedWord({ displayForm: lemma, lemma, gloss: 'x', exampleSentence, pos: 'phrase' }),
    ).not.toBeNull();
  });

  it.each([
    ['iyi ki', 'Hava güzel, geldin.'],
    ['por eso', 'Llegué tarde, no comí por la noche.'],
    ['ab und zu', 'Ich gehe ins Kino und zu Hause.'],
    ['o sea', 'No vino, se quedó en casa.'],
    ['¿qué tal?', '¿Qué haces hoy?'],
  ])('drops the all-short-token phrase %s when the example lacks it', (lemma, exampleSentence) => {
    expect(
      validateProposedWord({ displayForm: lemma, lemma, gloss: 'x', exampleSentence, pos: 'phrase' }),
    ).toBeNull();
  });

  it('matches a Turkish dotted capital İ against its lower-case lemma', () => {
    expect(
      validateProposedWord({
        displayForm: 'iyi',
        lemma: 'iyi',
        gloss: 'good',
        exampleSentence: 'İyi bir gün.',
        pos: 'adjective',
      }),
    ).not.toBeNull();
  });

  it('rejects missing/empty fields and non-objects', () => {
    expect(validateProposedWord({ lemma: 'x' })).toBeNull();
    expect(validateProposedWord(null)).toBeNull();
    expect(
      validateProposedWord({
        displayForm: '  ',
        lemma: 'x',
        gloss: 'y',
        exampleSentence: 'x here',
        pos: 'noun',
      }),
    ).toBeNull();
  });

  it('accepts via the displayForm-token fallback when the lemma itself is not a substring of the example (irregular plural)', () => {
    // "pez" -> "peces" (z→c before e); "pez" is not a substring of "peces",
    // so this only passes because the OR-fallback checks displayForm's
    // trailing token ("peces"), not just the lemma token ("pez").
    expect(
      validateProposedWord({
        displayForm: 'los peces',
        lemma: 'pez',
        gloss: 'fish',
        exampleSentence: 'Hay muchos peces en el río.',
        pos: 'noun',
      }),
    ).toEqual({
      displayForm: 'los peces',
      lemma: 'pez',
      gloss: 'fish',
      exampleSentence: 'Hay muchos peces en el río.',
      pos: 'noun',
    });
  });
});

describe('deriveTier', () => {
  it('bands by rank with null → extended', () => {
    expect(deriveTier(500)).toBe('core');
    expect(deriveTier(1000)).toBe('core');
    expect(deriveTier(2000)).toBe('common');
    expect(deriveTier(9000)).toBe('extended');
    expect(deriveTier(null)).toBe('extended');
  });

  it('bands the exact 2500 boundary (<=2500 common, >2500 extended)', () => {
    expect(deriveTier(2500)).toBe('common');
    expect(deriveTier(2501)).toBe('extended');
  });
});

describe('validateProposedWord — word class', () => {
  const base = { gloss: 'g', exampleSentence: '' };

  it('requires a known pos and normalizes its casing', () => {
    expect(
      validateProposedWord({ ...base, displayForm: 'comer', lemma: 'comer', pos: 'Verb', exampleSentence: 'Quiero comer pan.' }),
    ).toMatchObject({ pos: 'verb' });
    expect(
      validateProposedWord({ ...base, displayForm: 'comer', lemma: 'comer', pos: 'adj', exampleSentence: 'Quiero comer.' }),
    ).toBeNull();
    expect(
      validateProposedWord({ ...base, displayForm: 'comer', lemma: 'comer', exampleSentence: 'Quiero comer.' }),
    ).toBeNull();
  });

  it('accepts multi-token lemmas only for phrases and verbs, up to 4 tokens', () => {
    expect(
      validateProposedWord({ ...base, displayForm: 'echar de menos', lemma: 'echar de menos', pos: 'phrase', exampleSentence: 'Voy a echar de menos a mi familia.' }),
    ).not.toBeNull();
    expect(
      validateProposedWord({ ...base, displayForm: 'sich freuen auf', lemma: 'sich freuen auf', pos: 'verb', exampleSentence: 'Ich möchte mich auf den Urlaub freuen.' }),
    ).not.toBeNull();
    expect(
      validateProposedWord({ ...base, displayForm: 'acordarse de', lemma: 'acordarse de', pos: 'verb', exampleSentence: 'No puedo acordarme de su nombre.' }),
    ).not.toBeNull();
    expect(
      validateProposedWord({ ...base, displayForm: 'echar de menos', lemma: 'echar de menos', pos: 'phrase', exampleSentence: 'Hoy hace sol.' }),
    ).toBeNull(); // no token of the expression in the example
    expect(
      validateProposedWord({ ...base, displayForm: 'la cena fría', lemma: 'cena fría', pos: 'noun', exampleSentence: 'La cena fría.' }),
    ).toBeNull();
    expect(
      validateProposedWord({ ...base, displayForm: 'a b c d e', lemma: 'a b c d e', pos: 'phrase', exampleSentence: 'a b c d e' }),
    ).toBeNull();
  });

  it('requires a non-noun displayForm to equal its lemma', () => {
    expect(
      validateProposedWord({ ...base, displayForm: 'rápido/a', lemma: 'rápido', pos: 'adjective', exampleSentence: 'El tren es rápido.' }),
    ).toBeNull();
    expect(
      validateProposedWord({ ...base, displayForm: 'Rápido', lemma: 'rápido', pos: 'adjective', exampleSentence: 'El tren es rápido.' }),
    ).not.toBeNull();
  });

  it('keeps article display forms for nouns', () => {
    expect(
      validateProposedWord({ ...base, displayForm: 'la manzana', lemma: 'manzana', pos: 'noun', exampleSentence: 'Como una manzana.' }),
    ).toMatchObject({ displayForm: 'la manzana', pos: 'noun' });
  });

  it('enforces allowedPos when given', () => {
    const verb = { ...base, displayForm: 'comer', lemma: 'comer', pos: 'verb', exampleSentence: 'Quiero comer.' };
    expect(validateProposedWord(verb, ['verb'])).not.toBeNull();
    expect(validateProposedWord(verb, ['adjective', 'adverb'])).toBeNull();
  });

  it('accepts an inflected single-word verb or adjective on its stem', () => {
    const verb = (lemma: string, exampleSentence: string) =>
      validateProposedWord({ ...base, displayForm: lemma, lemma, pos: 'verb', exampleSentence });
    expect(verb('comer', 'Como pan todos los días.')).not.toBeNull();
    expect(verb('arrepentirse', 'No quiero arrepentirme de nada.')).not.toBeNull();
    expect(verb('levantarse', 'Me levanto a las siete.')).not.toBeNull();
    expect(
      validateProposedWord({ ...base, displayForm: 'blanco', lemma: 'blanco', pos: 'adjective', exampleSentence: 'Tengo una casa blanca.' }),
    ).not.toBeNull();
  });

  it('accepts a reflexive prepositional verb conjugated in its example', () => {
    expect(
      validateProposedWord({ ...base, displayForm: 'alegrarse de', lemma: 'alegrarse de', pos: 'verb', exampleSentence: 'Me alegro de verte.' }),
    ).not.toBeNull();
    expect(
      validateProposedWord({ ...base, displayForm: 'quejarse de', lemma: 'quejarse de', pos: 'verb', exampleSentence: 'Siempre se queja del ruido.' }),
    ).not.toBeNull();
  });

  it('still needs the stem: an example without the word is rejected', () => {
    expect(
      validateProposedWord({ ...base, displayForm: 'comer', lemma: 'comer', pos: 'verb', exampleSentence: 'Bebo agua.' }),
    ).toBeNull();
  });

  it('keeps words under 5 letters verbatim (no safe stem)', () => {
    const ver = { ...base, displayForm: 'ver', lemma: 'ver', pos: 'verb' };
    expect(validateProposedWord({ ...ver, exampleSentence: 'Quiero ver la película.' })).not.toBeNull();
    expect(validateProposedWord({ ...ver, exampleSentence: 'Veo la película.' })).toBeNull();
  });

  it('does not stem-match nouns or adverbs', () => {
    expect(
      validateProposedWord({ ...base, displayForm: 'temprano', lemma: 'temprano', pos: 'adverb', exampleSentence: 'Llegó tempranísimo.' }),
    ).toBeNull();
  });
});
