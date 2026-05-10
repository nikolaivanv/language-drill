import type { ReactNode } from 'react';
import type {
  TheoryBlockJson,
  TheoryInlineJson,
  TheorySectionJson,
  TheoryTopicJson,
} from '@language-drill/shared';

import {
  Callout,
  ConjugationTable,
  Example,
  Hilite,
  Mono,
  TheoryList,
} from './primitives';
import type { TheorySection, TheoryTopic } from './types';

/**
 * Walk a `TheoryTopicJson` and produce a runtime `TheoryTopic` whose section
 * bodies are JSX trees composed from the existing primitives in
 * `./primitives.tsx`. The output is structurally identical to a hand-authored
 * theory TSX file — section ids pass through byte-for-byte, and no
 * `<section>` wrapper is emitted (the panel's `TheoryContent` handles that).
 *
 * Pure function: no hooks, no effects, no caching. Calling twice with the
 * same input produces structurally identical React trees.
 */
export function renderTheoryTopicJson(topic: TheoryTopicJson): TheoryTopic {
  return {
    id: topic.id,
    title: topic.title,
    subtitle: topic.subtitle,
    cefr: topic.cefr,
    sections: topic.sections.map(renderSection),
  };
}

function renderSection(section: TheorySectionJson): TheorySection {
  return {
    id: section.id,
    title: section.title,
    body: <>{section.body.map((block, i) => renderBlock(block, i))}</>,
  };
}

function renderBlock(block: TheoryBlockJson, key: number): ReactNode {
  switch (block.kind) {
    case 'paragraph':
      return (
        <p key={key}>
          {block.text.map((inline, j) => renderInline(inline, j))}
        </p>
      );
    case 'callout':
      return (
        <Callout key={key} variant={block.variant}>
          {block.children.map((b, j) => renderBlock(b, j))}
        </Callout>
      );
    case 'example':
      return (
        <Example key={key}>
          <Example.ES>
            {block.target.map((inline, j) => renderInline(inline, j))}
          </Example.ES>
          <Example.EN>{block.en}</Example.EN>
          {block.note && (
            <Example.Note>
              {block.note.map((inline, j) => renderInline(inline, j))}
            </Example.Note>
          )}
        </Example>
      );
    case 'list':
      return (
        <TheoryList key={key}>
          {block.items.map((item, j) => (
            <li key={j}>{item.map((b, k) => renderBlock(b, k))}</li>
          ))}
        </TheoryList>
      );
    case 'conjugation-table':
      return (
        <ConjugationTable key={key}>
          <thead>
            <tr>
              {block.head.map((h, j) => (
                <th key={j}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, j) => (
              <tr key={j}>
                {row.map((cell, k) => (
                  <td key={k}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </ConjugationTable>
      );
    default: {
      const _exhaustive: never = block;
      throw new Error(
        `Unknown block kind: ${(_exhaustive as TheoryBlockJson).kind}`,
      );
    }
  }
}

function renderInline(inline: TheoryInlineJson, key: number): ReactNode {
  switch (inline.kind) {
    case 'text':
      return inline.text;
    case 'strong':
      return (
        <strong key={key}>
          {inline.children.map((c, j) => renderInline(c, j))}
        </strong>
      );
    case 'em':
      return (
        <em key={key}>
          {inline.children.map((c, j) => renderInline(c, j))}
        </em>
      );
    case 'hilite':
      return (
        <Hilite key={key}>
          {inline.children.map((c, j) => renderInline(c, j))}
        </Hilite>
      );
    case 'mono':
      return (
        <Mono key={key}>
          {inline.children.map((c, j) => renderInline(c, j))}
        </Mono>
      );
    default: {
      const _exhaustive: never = inline;
      throw new Error(
        `Unknown inline kind: ${(_exhaustive as TheoryInlineJson).kind}`,
      );
    }
  }
}
