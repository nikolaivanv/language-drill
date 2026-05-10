import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  parseTheoryTopicJson,
  type TheoryTopicJson,
} from '@language-drill/shared';
import { renderTheoryTopicJson } from '../render-json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(
  __dirname,
  '../../../../../packages/db/scripts/__fixtures__/theory-json',
);

const subjunctiveJson = parseTheoryTopicJson(
  JSON.parse(
    readFileSync(path.join(fixturesDir, 'subjunctive.json'), 'utf-8'),
  ),
);
const minimalJson = parseTheoryTopicJson(
  JSON.parse(readFileSync(path.join(fixturesDir, 'minimal.json'), 'utf-8')),
);

function sectionById(topic: ReturnType<typeof renderTheoryTopicJson>, id: string) {
  const section = topic.sections.find((s) => s.id === id);
  if (!section) throw new Error(`section ${id} not found`);
  return section;
}

describe('renderTheoryTopicJson — top-level shape', () => {
  it('preserves topic-level fields byte-for-byte', () => {
    const rendered = renderTheoryTopicJson(subjunctiveJson);
    expect(rendered.id).toBe(subjunctiveJson.id);
    expect(rendered.title).toBe(subjunctiveJson.title);
    expect(rendered.subtitle).toBe(subjunctiveJson.subtitle);
    expect(rendered.cefr).toBe(subjunctiveJson.cefr);
    expect(rendered.sections).toHaveLength(subjunctiveJson.sections.length);
  });

  it('preserves section ids byte-for-byte (scroll-spy contract)', () => {
    const rendered = renderTheoryTopicJson(subjunctiveJson);
    expect(rendered.sections.map((s) => s.id)).toEqual(
      subjunctiveJson.sections.map((s) => s.id),
    );
  });

  it('renders every section of the subjunctive fixture without throwing', () => {
    const rendered = renderTheoryTopicJson(subjunctiveJson);
    for (const section of rendered.sections) {
      const { unmount } = render(<>{section.body}</>);
      unmount();
    }
  });

  it('renders the minimal fixture without throwing', () => {
    const rendered = renderTheoryTopicJson(minimalJson);
    render(<>{rendered.sections[0].body}</>);
    expect(screen.getByText('Just one paragraph.')).toBeInTheDocument();
  });
});

describe('renderTheoryTopicJson — block primitives', () => {
  it('renders Callout with variant="warn" as the warn class', () => {
    const rendered = renderTheoryTopicJson(subjunctiveJson);
    const when = sectionById(rendered, 'when');
    const { container } = render(<>{when.body}</>);
    const warnCallout = container.querySelector('.callout.warn');
    expect(warnCallout).not.toBeNull();
    expect(within(warnCallout as HTMLElement).getByText(/WEIRDO/)).toBeInTheDocument();
  });

  it('renders Callout default variant without the warn class', () => {
    const rendered = renderTheoryTopicJson(subjunctiveJson);
    const what = sectionById(rendered, 'what');
    const { container } = render(<>{what.body}</>);
    const callouts = container.querySelectorAll('.callout');
    expect(callouts.length).toBeGreaterThan(0);
    // The "indicative = facts" callout in `what` is the default variant —
    // should NOT carry the warn class.
    const defaultCallout = Array.from(callouts).find(
      (el) => !el.classList.contains('warn'),
    );
    expect(defaultCallout).toBeDefined();
  });

  it('renders Example with Example.Note containing <em> when note is present', () => {
    const rendered = renderTheoryTopicJson(subjunctiveJson);
    const examples = sectionById(rendered, 'examples');
    const { container } = render(<>{examples.body}</>);
    const notes = container.querySelectorAll('.example-note');
    expect(notes.length).toBeGreaterThan(0);
    // First example's note contains <em>tener</em>.
    const tener = within(notes[0] as HTMLElement).getByText('tener');
    expect(tener.tagName).toBe('EM');
  });

  it('omits Example.Note when note is undefined', () => {
    const topic: TheoryTopicJson = {
      id: 'no-note',
      title: 'no note topic',
      subtitle: 'one example, no note',
      cefr: 'A1',
      sections: [
        {
          id: 'only',
          title: 'only',
          body: [
            {
              kind: 'example',
              target: [{ kind: 'text', text: 'Hola.' }],
              en: 'Hi.',
            },
          ],
        },
      ],
    };
    const rendered = renderTheoryTopicJson(topic);
    const { container } = render(<>{rendered.sections[0].body}</>);
    expect(container.querySelector('.example-note')).toBeNull();
    expect(container.querySelector('.example-es')).not.toBeNull();
    expect(container.querySelector('.example-en')).not.toBeNull();
  });

  it('renders ConjugationTable with the expected th / tr / td counts', () => {
    const rendered = renderTheoryTopicJson(subjunctiveJson);
    const formRegular = sectionById(rendered, 'form-regular');
    const { container } = render(<>{formRegular.body}</>);
    const table = container.querySelector('table.theory-table');
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll('th')).toHaveLength(4);
    expect(table!.querySelectorAll('tr')).toHaveLength(7); // 1 head + 6 body
    expect(table!.querySelectorAll('td')).toHaveLength(24); // 6 × 4
  });

  it('renders TheoryList with one <li> per item', () => {
    const rendered = renderTheoryTopicJson(subjunctiveJson);
    const pitfalls = sectionById(rendered, 'pitfalls');
    const { container } = render(<>{pitfalls.body}</>);
    const ul = container.querySelector('ul.theory-list');
    expect(ul).not.toBeNull();
    expect(ul!.querySelectorAll(':scope > li')).toHaveLength(4);
  });
});

describe('renderTheoryTopicJson — inline primitives', () => {
  it('renders Hilite inline with the .hilite class', () => {
    const rendered = renderTheoryTopicJson(subjunctiveJson);
    const what = sectionById(rendered, 'what');
    const { container } = render(<>{what.body}</>);
    const hilites = container.querySelectorAll('.hilite');
    expect(hilites.length).toBeGreaterThan(0);
    expect(hilites[0].textContent).toBe('subjunctive');
  });

  it('renders Mono inline with the .t-mono class', () => {
    const rendered = renderTheoryTopicJson(subjunctiveJson);
    const when = sectionById(rendered, 'when');
    const { container } = render(<>{when.body}</>);
    const monos = container.querySelectorAll('.t-mono');
    expect(monos.length).toBeGreaterThan(0);
  });

  it('renders nested inline (em > strong) as <em><strong>...</strong></em>', () => {
    const topic: TheoryTopicJson = {
      id: 'nested',
      title: 'nested',
      subtitle: 'nested inline test',
      cefr: 'A1',
      sections: [
        {
          id: 'only',
          title: 'only',
          body: [
            {
              kind: 'paragraph',
              text: [
                {
                  kind: 'em',
                  children: [
                    { kind: 'text', text: 'i suggest he ' },
                    {
                      kind: 'strong',
                      children: [{ kind: 'text', text: 'be' }],
                    },
                    { kind: 'text', text: ' here' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const rendered = renderTheoryTopicJson(topic);
    const { container } = render(<>{rendered.sections[0].body}</>);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe('be');
    expect(strong!.parentElement?.tagName).toBe('EM');
  });
});

describe('renderTheoryTopicJson — calibration anchors (subjunctive)', () => {
  it('contains "WEIRDO" anchor', () => {
    const rendered = renderTheoryTopicJson(subjunctiveJson);
    const when = sectionById(rendered, 'when');
    render(<>{when.body}</>);
    expect(screen.getByText(/WEIRDO/)).toBeInTheDocument();
  });

  it('contains "opposite vowel" anchor', () => {
    const rendered = renderTheoryTopicJson(subjunctiveJson);
    const formRegular = sectionById(rendered, 'form-regular');
    render(<>{formRegular.body}</>);
    expect(screen.getByText(/opposite vowel/)).toBeInTheDocument();
  });

  it('contains "DISHES" anchor', () => {
    const rendered = renderTheoryTopicJson(subjunctiveJson);
    const formIrregular = sectionById(rendered, 'form-irregular');
    render(<>{formIrregular.body}</>);
    expect(screen.getByText(/DISHES/)).toBeInTheDocument();
  });

  it('contains "subjunctive of" anchor', () => {
    const rendered = renderTheoryTopicJson(subjunctiveJson);
    const examples = sectionById(rendered, 'examples');
    render(<>{examples.body}</>);
    expect(screen.getAllByText(/subjunctive of/).length).toBeGreaterThan(0);
  });
});
