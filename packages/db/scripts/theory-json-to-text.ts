/**
 * Plain-text renderer for `TheoryTopicJson`.
 *
 * Walks the JSON taxonomy from `packages/shared/src/theory.ts` and emits a
 * terminal-readable dump suitable for the `pnpm review:flagged-theory`
 * CLI. Mirrors the exercise CLI's `JSON.stringify(row.contentJson, null,
 * 2)` substitution — theory's deep tree is unreadable as raw JSON; this
 * renderer collapses it to a section/paragraph/example dump a reviewer
 * can scan at glance.
 *
 * No styling — emphasis (strong/em/hilite/mono) is dropped; grep-ability
 * over the terminal output wins (Req 5.7).
 *
 * Lives next to the CLI rather than in `packages/shared/` because plain-
 * text rendering is a CLI concern (the web renderer is JSX-based; sharing
 * a helper would create a one-consumer abstraction).
 */

import type {
  TheoryBlockJson,
  TheoryInlineJson,
  TheorySectionJson,
  TheoryTopicJson,
} from '@language-drill/shared';

const COLS = 80;

// ---------------------------------------------------------------------------
// Inline rendering
// ---------------------------------------------------------------------------

/**
 * Collapse a `TheoryInlineJson` node to its text content. Emphasis wrapper
 * variants (`strong`, `em`, `hilite`, `mono`) drop their styling and keep
 * only the underlying text so the reviewer reads the same words a learner
 * would, without terminal escape codes.
 */
function renderInline(node: TheoryInlineJson): string {
  switch (node.kind) {
    case 'text':
      return node.text;
    case 'strong':
    case 'em':
    case 'hilite':
    case 'mono':
      return node.children.map(renderInline).join('');
  }
}

function renderInlines(nodes: TheoryInlineJson[]): string {
  return nodes.map(renderInline).join('');
}

// ---------------------------------------------------------------------------
// Word wrap
// ---------------------------------------------------------------------------

/**
 * Wrap `text` at word boundaries to fit within `cols` columns. The first
 * line is prefixed with `firstLinePrefix`; subsequent lines use
 * `continuationPrefix` (defaults to `firstLinePrefix` for the common case
 * where the indent is uniform).
 *
 * Words longer than the available column width are emitted on their own
 * line uncut — splitting them would corrupt the reviewer's reading of
 * vocabulary or example sentences.
 */
function wordWrap(
  text: string,
  cols: number,
  firstLinePrefix: string,
  continuationPrefix: string = firstLinePrefix,
): string {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) {
    return firstLinePrefix;
  }

  const lines: string[] = [];
  let current = '';
  let onFirstLine = true;

  for (const word of words) {
    const prefix = onFirstLine ? firstLinePrefix : continuationPrefix;
    const maxLine = Math.max(1, cols - prefix.length);
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxLine) {
      current += ` ${word}`;
    } else {
      lines.push(prefix + current);
      current = word;
      onFirstLine = false;
    }
  }
  if (current.length > 0) {
    const prefix = onFirstLine ? firstLinePrefix : continuationPrefix;
    lines.push(prefix + current);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

/**
 * Render a sequence of blocks separated by blank lines. The blank-line
 * separator is intentional — a wall of unbroken text in the reviewer's
 * terminal is harder to scan than a section with visible paragraph breaks.
 */
function renderBlocks(blocks: TheoryBlockJson[], indent: string): string {
  return blocks.map((b) => renderBlock(b, indent)).join('\n\n');
}

function renderBlock(block: TheoryBlockJson, indent: string): string {
  switch (block.kind) {
    case 'paragraph': {
      return wordWrap(renderInlines(block.text), COLS, indent);
    }

    case 'callout': {
      // Children render at indent + '  '; replace the first line's leading
      // indent with `${indent}! ` so the callout marker is visible.
      const innerIndent = `${indent}  `;
      const inner = renderBlocks(block.children, innerIndent);
      const calloutPrefix = `${indent}! `;
      if (inner.startsWith(innerIndent)) {
        return calloutPrefix + inner.slice(innerIndent.length);
      }
      // Defensive: inner didn't start with the expected indent (empty
      // children, or wordWrap returning bare prefix on whitespace-only).
      return calloutPrefix + inner;
    }

    case 'example': {
      const target = renderInlines(block.target);
      const lines = [
        `${indent}• target: ${target}`,
        `${indent}  en:     ${block.en}`,
      ];
      if (block.note && block.note.length > 0) {
        const noteText = renderInlines(block.note);
        // Continuation indent matches the width of "  note:   " (10
        // chars) so a multi-line note stays visually aligned under the
        // label.
        const notePrefix = `${indent}  note:   `;
        const noteContinuation = `${indent}          `;
        lines.push(wordWrap(noteText, COLS, notePrefix, noteContinuation));
      }
      return lines.join('\n');
    }

    case 'list': {
      // Each item is a TheoryBlockJson[]. Render the item's blocks at
      // indent + '  ', then swap the first line's leading indent for
      // `${indent}- ` so the bullet is visible.
      const itemIndent = `${indent}  `;
      const bulletPrefix = `${indent}- `;
      const renderedItems = block.items.map((item) => {
        const inner = renderBlocks(item, itemIndent);
        if (inner.startsWith(itemIndent)) {
          return bulletPrefix + inner.slice(itemIndent.length);
        }
        return bulletPrefix + inner;
      });
      return renderedItems.join('\n');
    }

    case 'conjugation-table': {
      const allRows = [block.head, ...block.rows];
      const numCols = block.head.length;
      const widths: number[] = Array.from({ length: numCols }, () => 0);
      for (const row of allRows) {
        for (let i = 0; i < numCols; i++) {
          const cell = row[i] ?? '';
          if (cell.length > widths[i]) widths[i] = cell.length;
        }
      }
      const formatRow = (row: string[]) =>
        (
          indent +
          row
            .map((cell, i) => (cell ?? '').padEnd(widths[i]))
            .join('  ')
        ).replace(/\s+$/, '');
      return allRows.map(formatRow).join('\n');
    }
  }
}

// ---------------------------------------------------------------------------
// Topic rendering
// ---------------------------------------------------------------------------

/**
 * Render a `TheoryTopicJson` to plain text:
 *
 *   <title>
 *   > <subtitle>
 *
 *   ## <section title>
 *   <section body>
 *
 *   ## <section title>
 *   <section body>
 *
 * The `> ` line for subtitle is emitted even when subtitle is empty (so
 * the header shape is consistent and parsers/operators expecting two
 * leading lines aren't surprised).
 */
export function theoryTopicJsonToText(topic: TheoryTopicJson): string {
  const headerLines = [topic.title, `> ${topic.subtitle}`, ''];
  const sectionChunks = topic.sections.map((section) =>
    renderSection(section),
  );
  return [...headerLines, ...sectionChunks].join('\n');
}

function renderSection(section: TheorySectionJson): string {
  const lines = [`## ${section.title}`];
  if (section.body.length > 0) {
    lines.push(renderBlocks(section.body, ''));
  }
  lines.push('');
  return lines.join('\n');
}
