/**
 * Unit tests for the plain-text theory renderer (`theory-json-to-text.ts`).
 *
 * Hand-built `TheoryTopicJson` literals — no on-disk fixtures, no DB, no
 * Claude. Each block kind and each inline kind has its own `it`; nested
 * callouts and word wrap are exercised separately.
 */

import { describe, expect, it } from 'vitest';
import type {
  TheoryBlockJson,
  TheoryInlineJson,
  TheoryTopicJson,
} from '@language-drill/shared';

import { theoryTopicJsonToText } from './theory-json-to-text';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function plainText(text: string): TheoryInlineJson[] {
  return [{ kind: 'text', text }];
}

function makeTopic(body: TheoryBlockJson[]): TheoryTopicJson {
  return {
    id: 'test-topic',
    title: 'test title',
    subtitle: 'test subtitle',
    cefr: 'B1',
    sections: [
      {
        id: 'sec',
        title: 'section',
        body,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Topic header
// ---------------------------------------------------------------------------

describe('theoryTopicJsonToText — header', () => {
  it('emits title, subtitle, and a blank line above the first section', () => {
    const topic = makeTopic([
      { kind: 'paragraph', text: plainText('hello') },
    ]);
    const out = theoryTopicJsonToText(topic);
    const lines = out.split('\n');
    expect(lines[0]).toBe('test title');
    expect(lines[1]).toBe('> test subtitle');
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('## section');
  });

  it('emits "> " even when subtitle is empty', () => {
    const topic = makeTopic([
      { kind: 'paragraph', text: plainText('hi') },
    ]);
    topic.subtitle = '';
    const out = theoryTopicJsonToText(topic);
    expect(out.split('\n')[1]).toBe('> ');
  });
});

// ---------------------------------------------------------------------------
// Block kinds — one `it` each (Req 5.7 / 6.3)
// ---------------------------------------------------------------------------

describe('theoryTopicJsonToText — block kinds', () => {
  it('renders a paragraph as plain inline text', () => {
    const out = theoryTopicJsonToText(
      makeTopic([{ kind: 'paragraph', text: plainText('hello world') }]),
    );
    expect(out).toContain('hello world');
  });

  it('renders a callout with a "! " marker at indent', () => {
    const out = theoryTopicJsonToText(
      makeTopic([
        {
          kind: 'callout',
          children: [
            { kind: 'paragraph', text: plainText('important note here') },
          ],
        },
      ]),
    );
    expect(out).toContain('! important note here');
  });

  it('renders an example with target/en/note lines', () => {
    const out = theoryTopicJsonToText(
      makeTopic([
        {
          kind: 'example',
          target: plainText('hola mundo'),
          en: 'hello world',
          note: plainText('a greeting'),
        },
      ]),
    );
    expect(out).toContain('• target: hola mundo');
    expect(out).toContain('  en:     hello world');
    expect(out).toContain('  note:   a greeting');
  });

  it('omits the note line when note is absent', () => {
    const out = theoryTopicJsonToText(
      makeTopic([
        {
          kind: 'example',
          target: plainText('hola'),
          en: 'hi',
        },
      ]),
    );
    expect(out).toContain('• target: hola');
    expect(out).toContain('  en:     hi');
    expect(out).not.toContain('note:');
  });

  it('renders a list with "- " bullets at indent', () => {
    const out = theoryTopicJsonToText(
      makeTopic([
        {
          kind: 'list',
          items: [
            [{ kind: 'paragraph', text: plainText('first item') }],
            [{ kind: 'paragraph', text: plainText('second item') }],
          ],
        },
      ]),
    );
    expect(out).toContain('- first item');
    expect(out).toContain('- second item');
  });

  it('renders a conjugation-table as a column-padded grid', () => {
    const out = theoryTopicJsonToText(
      makeTopic([
        {
          kind: 'conjugation-table',
          head: ['person', '-ar', '-er'],
          rows: [
            ['yo', 'hablo', 'como'],
            ['tú', 'hablas', 'comes'],
          ],
        },
      ]),
    );
    // Header row + each data row should appear in the output.
    expect(out).toContain('person');
    expect(out).toContain('-ar');
    expect(out).toContain('yo');
    expect(out).toContain('hablo');
    expect(out).toContain('tú');
    expect(out).toContain('hablas');
    // Header and yo's row should be visibly column-aligned: each cell is
    // padEnd-ed to the column's max width, then joined with two spaces.
    // 'person'.length === 6, 'yo'.length === 2 — yo's row starts with
    // 'yo' + 4 padding spaces + 2 separator = 'yo    '.
    expect(out).toMatch(/yo\s{4,}hablo/);
  });
});

// ---------------------------------------------------------------------------
// Inline kinds — emphasis drops, text survives (Req 5.7)
// ---------------------------------------------------------------------------

describe('theoryTopicJsonToText — inline kinds drop styling', () => {
  it('renders plain text directly', () => {
    const out = theoryTopicJsonToText(
      makeTopic([
        {
          kind: 'paragraph',
          text: [{ kind: 'text', text: 'just words' }],
        },
      ]),
    );
    expect(out).toContain('just words');
  });

  it.each(['strong', 'em', 'hilite', 'mono'] as const)(
    'drops %s wrapper and keeps the underlying text',
    (kind) => {
      const out = theoryTopicJsonToText(
        makeTopic([
          {
            kind: 'paragraph',
            text: [
              { kind: 'text', text: 'see ' },
              {
                kind,
                children: [{ kind: 'text', text: 'this word' }],
              },
              { kind: 'text', text: ' please' },
            ],
          },
        ]),
      );
      // Underlying text survives; markup wrappers are not in the output.
      expect(out).toContain('see this word please');
      expect(out).not.toContain('strong');
      expect(out).not.toContain('hilite');
    },
  );

  it('handles nested inline wrappers (em inside strong) without escaping', () => {
    const out = theoryTopicJsonToText(
      makeTopic([
        {
          kind: 'paragraph',
          text: [
            {
              kind: 'strong',
              children: [
                { kind: 'text', text: 'I really ' },
                {
                  kind: 'em',
                  children: [{ kind: 'text', text: 'mean' }],
                },
                { kind: 'text', text: ' it' },
              ],
            },
          ],
        },
      ]),
    );
    expect(out).toContain('I really mean it');
  });
});

// ---------------------------------------------------------------------------
// Nested callouts — inner indent grows by two spaces
// ---------------------------------------------------------------------------

describe('theoryTopicJsonToText — nested callouts', () => {
  it('indents the inner callout two spaces deeper than the outer paragraph baseline', () => {
    const out = theoryTopicJsonToText(
      makeTopic([
        {
          kind: 'callout',
          children: [
            { kind: 'paragraph', text: plainText('outer line') },
            {
              kind: 'callout',
              children: [
                { kind: 'paragraph', text: plainText('nested message') },
              ],
            },
          ],
        },
      ]),
    );
    // Outer callout's paragraph is at indent + '! ' = column 2 onward:
    expect(out).toContain('! outer line');
    // The inner callout's marker is offset two spaces inside the outer's
    // body indent (column 4 onward → '  ! '), with the nested paragraph
    // body appearing on the same line after the inner marker.
    expect(out).toContain('  ! nested message');
  });

  it('stacks callout markers when the outer callout wraps only a nested callout', () => {
    const out = theoryTopicJsonToText(
      makeTopic([
        {
          kind: 'callout',
          children: [
            {
              kind: 'callout',
              children: [
                { kind: 'paragraph', text: plainText('deeply nested') },
              ],
            },
          ],
        },
      ]),
    );
    // Both markers land on the first body line — outer at column 0, inner
    // at column 2 (the outer's body indent).
    expect(out).toContain('! ! deeply nested');
  });
});

// ---------------------------------------------------------------------------
// Word wrap — paragraphs longer than COLS (80) wrap on word boundaries
// ---------------------------------------------------------------------------

describe('theoryTopicJsonToText — word wrap', () => {
  it('wraps a 200-char paragraph at 80 cols on word boundaries', () => {
    // 25 four-letter words = 100 chars without spaces; with spaces 124 chars.
    // Use a 200-char string with regular word boundaries.
    const words = Array.from({ length: 40 }, () => 'word').join(' ');
    expect(words.length).toBeGreaterThan(80);

    const out = theoryTopicJsonToText(
      makeTopic([{ kind: 'paragraph', text: plainText(words) }]),
    );

    const bodyLines = out
      .split('\n')
      .filter((l) => l.includes('word'));
    expect(bodyLines.length).toBeGreaterThan(1);
    for (const line of bodyLines) {
      expect(line.length).toBeLessThanOrEqual(80);
      // Wrap happens on whitespace — no line ends mid-word.
      expect(line).not.toMatch(/wor$/);
      expect(line).not.toMatch(/^d /);
    }
  });

  it('emits a single line for short paragraphs', () => {
    const out = theoryTopicJsonToText(
      makeTopic([
        { kind: 'paragraph', text: plainText('short sentence') },
      ]),
    );
    const bodyLines = out
      .split('\n')
      .filter((l) => l.includes('short sentence'));
    expect(bodyLines).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Hand-authored-fixture round trip — assert no throw on a realistic topic
// ---------------------------------------------------------------------------

describe('theoryTopicJsonToText — realistic topic round-trip', () => {
  it('renders a multi-section topic with mixed block kinds without throwing', () => {
    const topic: TheoryTopicJson = {
      id: 'preterite-imperfect',
      title: 'preterite vs imperfect',
      subtitle: 'two pasts, two roles',
      cefr: 'B1',
      sections: [
        {
          id: 'what',
          title: 'what is it?',
          body: [
            {
              kind: 'paragraph',
              text: [
                { kind: 'text', text: 'spanish has ' },
                {
                  kind: 'strong',
                  children: [{ kind: 'text', text: 'two simple pasts' }],
                },
                { kind: 'text', text: ', not one.' },
              ],
            },
            {
              kind: 'callout',
              children: [
                {
                  kind: 'paragraph',
                  text: plainText(
                    'preterite = a completed event; imperfect = an ongoing background.',
                  ),
                },
              ],
            },
          ],
        },
        {
          id: 'examples',
          title: 'examples',
          body: [
            {
              kind: 'list',
              items: [
                [
                  {
                    kind: 'example',
                    target: plainText('ayer comí pizza'),
                    en: 'yesterday I ate pizza',
                    note: plainText('preterite — a completed event'),
                  },
                ],
                [
                  {
                    kind: 'example',
                    target: plainText('comía pizza cuando llamaste'),
                    en: 'I was eating pizza when you called',
                    note: plainText('imperfect — ongoing background'),
                  },
                ],
              ],
            },
          ],
        },
        {
          id: 'formation',
          title: 'formation',
          body: [
            {
              kind: 'conjugation-table',
              head: ['person', 'preterite', 'imperfect'],
              rows: [
                ['yo', 'comí', 'comía'],
                ['tú', 'comiste', 'comías'],
              ],
            },
          ],
        },
      ],
    };

    let out = '';
    expect(() => {
      out = theoryTopicJsonToText(topic);
    }).not.toThrow();

    // Spot-check a few invariants — header, all three section titles, and
    // a representative cell from each block kind.
    expect(out).toContain('preterite vs imperfect');
    expect(out).toContain('## what is it?');
    expect(out).toContain('## examples');
    expect(out).toContain('## formation');
    expect(out).toContain('spanish has two simple pasts, not one.');
    expect(out).toContain('! preterite = a completed event');
    expect(out).toContain('- • target: ayer comí pizza');
    expect(out).toContain('comí');
  });
});
