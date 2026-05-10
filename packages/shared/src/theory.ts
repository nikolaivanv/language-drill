/**
 * JSON-serializable taxonomy for theory topics.
 *
 * Runtime mirror: `apps/web/components/theory/types.ts` exports `TheoryTopic`
 * and `TheorySection`, whose `body` is `React.ReactNode`. The JSON shape here
 * has the same field names but uses `TheoryBlockJson[]` for `body` so the
 * payload can be emitted by Claude tool use, validated by `parseTheoryTopicJson`,
 * stored as `JSONB` in `theory_topics.content_json`, and rehydrated into a
 * runtime `TheoryTopic` by `renderTheoryTopicJson`.
 *
 * Resolved decision #11 (from `docs/theory-generation-plan.md`): the three
 * hand-authored TSX topics in `apps/web/content/theory/es/` are NOT migrated
 * to JSON. They remain the panel's editorial-override path; the JSON taxonomy
 * here is for generated content only.
 */

export type TheoryInlineJson =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: TheoryInlineJson[] }
  | { kind: "em"; children: TheoryInlineJson[] }
  | { kind: "hilite"; children: TheoryInlineJson[] }
  | { kind: "mono"; children: TheoryInlineJson[] };

export type TheoryBlockJson =
  | { kind: "paragraph"; text: TheoryInlineJson[] }
  | { kind: "callout"; variant?: "default" | "warn"; children: TheoryBlockJson[] }
  | { kind: "example"; target: TheoryInlineJson[]; en: string; note?: TheoryInlineJson[] }
  | { kind: "list"; items: TheoryBlockJson[][] }
  | { kind: "conjugation-table"; head: string[]; rows: string[][] };

export type TheorySectionJson = {
  id: string;
  title: string;
  body: TheoryBlockJson[];
};

export type TheoryTopicJson = {
  id: string;
  title: string;
  subtitle: string;
  cefr: string;
  sections: TheorySectionJson[];
};

// ---------------------------------------------------------------------------
// Runtime parser — validates `unknown` input against the taxonomy with
// field-level error messages. Mirror of `parseGeneratedClozeDraft` in
// `packages/ai/src/generate.ts`, but lives here so `packages/shared` stays
// standalone (no dependency on `packages/ai`).
//
// Every error carries a `path` prefix like `sections[2].body[1].rows[3]` so
// callers (Phase 2's CLI, Phase 5's read path) can write the message verbatim
// into `theory_generation_jobs.error_message`.
// ---------------------------------------------------------------------------

const SECTION_ID_REGEX = /^[a-z][a-z0-9-]*$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function joinPath(path: string, field: string): string {
  return path === "" ? field : `${path}.${field}`;
}

function requireString(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): string {
  const fp = joinPath(path, field);
  const v = raw[field];
  if (v === undefined) {
    throw new Error(`Invalid ${fp}: must be present, got undefined`);
  }
  if (typeof v !== "string") {
    throw new Error(
      `Invalid ${fp}: must be a non-empty string, got ${JSON.stringify(v)}`,
    );
  }
  if (v.length === 0) {
    throw new Error(`Invalid ${fp}: must be a non-empty string, got ""`);
  }
  return v;
}

function requireNonEmptyArray(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): unknown[] {
  const fp = joinPath(path, field);
  const v = raw[field];
  if (v === undefined) {
    throw new Error(`Invalid ${fp}: must be present, got undefined`);
  }
  if (!Array.isArray(v)) {
    throw new Error(
      `Invalid ${fp}: must be a non-empty array, got ${JSON.stringify(v)}`,
    );
  }
  if (v.length === 0) {
    throw new Error(`Invalid ${fp}: must be a non-empty array, got []`);
  }
  return v;
}

function requireOptionalArray(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): unknown[] | undefined {
  const v = raw[field];
  if (v === undefined) return undefined;
  const fp = joinPath(path, field);
  if (!Array.isArray(v)) {
    throw new Error(
      `Invalid ${fp}: must be a non-empty array when present, got ${JSON.stringify(v)}`,
    );
  }
  if (v.length === 0) {
    throw new Error(
      `Invalid ${fp}: must be a non-empty array when present, got []`,
    );
  }
  return v;
}

export function parseInline(raw: unknown, path: string): TheoryInlineJson {
  if (!isObject(raw)) {
    throw new Error(
      `Invalid ${path}: must be an object, got ${describeType(raw)}`,
    );
  }
  const kind = raw.kind;
  if (kind === undefined) {
    throw new Error(`Invalid ${path}.kind: must be present, got undefined`);
  }
  if (typeof kind !== "string") {
    throw new Error(
      `Invalid ${path}.kind: unknown inline kind, got ${JSON.stringify(kind)}`,
    );
  }
  switch (kind) {
    case "text": {
      const text = raw.text;
      if (text === undefined) {
        throw new Error(`Invalid ${path}.text: must be present, got undefined`);
      }
      if (typeof text !== "string") {
        throw new Error(
          `Invalid ${path}.text: must be a non-empty string, got ${JSON.stringify(text)}`,
        );
      }
      if (text.length === 0) {
        throw new Error(
          `Invalid ${path}.text: must be a non-empty string, got ""`,
        );
      }
      return { kind: "text", text };
    }
    case "strong":
    case "em":
    case "hilite":
    case "mono": {
      const children = requireNonEmptyArray(raw, "children", path);
      const parsed = children.map((c, k) =>
        parseInline(c, `${path}.children[${k}]`),
      );
      return { kind, children: parsed };
    }
    default:
      throw new Error(
        `Invalid ${path}.kind: unknown inline kind, got ${JSON.stringify(kind)}`,
      );
  }
}

export function parseBlock(raw: unknown, path: string): TheoryBlockJson {
  if (!isObject(raw)) {
    throw new Error(
      `Invalid ${path}: must be an object, got ${describeType(raw)}`,
    );
  }
  const kind = raw.kind;
  if (kind === undefined) {
    throw new Error(`Invalid ${path}.kind: must be present, got undefined`);
  }
  if (typeof kind !== "string") {
    throw new Error(
      `Invalid ${path}.kind: unknown block kind, got ${JSON.stringify(kind)}`,
    );
  }
  switch (kind) {
    case "paragraph": {
      const text = requireNonEmptyArray(raw, "text", path);
      const parsed = text.map((inline, k) =>
        parseInline(inline, `${path}.text[${k}]`),
      );
      return { kind: "paragraph", text: parsed };
    }
    case "callout": {
      const variant = raw.variant;
      if (
        variant !== undefined &&
        variant !== "default" &&
        variant !== "warn"
      ) {
        throw new Error(
          `Invalid ${path}.variant: must be "default" | "warn" when present, got ${JSON.stringify(variant)}`,
        );
      }
      const children = requireNonEmptyArray(raw, "children", path);
      const parsed = children.map((b, k) =>
        parseBlock(b, `${path}.children[${k}]`),
      );
      return variant === undefined
        ? { kind: "callout", children: parsed }
        : { kind: "callout", variant, children: parsed };
    }
    case "example": {
      const target = requireNonEmptyArray(raw, "target", path);
      const parsedTarget = target.map((inline, k) =>
        parseInline(inline, `${path}.target[${k}]`),
      );
      const en = raw.en;
      if (en === undefined) {
        throw new Error(`Invalid ${path}.en: must be present, got undefined`);
      }
      if (typeof en !== "string") {
        throw new Error(
          `Invalid ${path}.en: must be a non-empty string, got ${JSON.stringify(en)}`,
        );
      }
      if (en.length === 0) {
        throw new Error(
          `Invalid ${path}.en: must be a non-empty string, got ""`,
        );
      }
      const noteRaw = requireOptionalArray(raw, "note", path);
      if (noteRaw === undefined) {
        return { kind: "example", target: parsedTarget, en };
      }
      const parsedNote = noteRaw.map((inline, k) =>
        parseInline(inline, `${path}.note[${k}]`),
      );
      return { kind: "example", target: parsedTarget, en, note: parsedNote };
    }
    case "list": {
      const items = requireNonEmptyArray(raw, "items", path);
      const parsedItems: TheoryBlockJson[][] = items.map((item, k) => {
        const itemPath = `${path}.items[${k}]`;
        if (!Array.isArray(item)) {
          throw new Error(
            `Invalid ${itemPath}: must be a non-empty array, got ${JSON.stringify(item)}`,
          );
        }
        if (item.length === 0) {
          throw new Error(
            `Invalid ${itemPath}: must be a non-empty array, got []`,
          );
        }
        return item.map((block, j) => parseBlock(block, `${itemPath}[${j}]`));
      });
      return { kind: "list", items: parsedItems };
    }
    case "conjugation-table": {
      const head = requireNonEmptyArray(raw, "head", path);
      const parsedHead = head.map((h, k) => {
        if (typeof h !== "string") {
          throw new Error(
            `Invalid ${path}.head[${k}]: must be a string, got ${JSON.stringify(h)}`,
          );
        }
        return h;
      });
      const rows = requireNonEmptyArray(raw, "rows", path);
      const parsedRows: string[][] = rows.map((row, k) => {
        const rowPath = `${path}.rows[${k}]`;
        if (!Array.isArray(row)) {
          throw new Error(
            `Invalid ${rowPath}: must be an array, got ${JSON.stringify(row)}`,
          );
        }
        if (row.length !== parsedHead.length) {
          throw new Error(
            `Invalid ${rowPath}: must have length ${parsedHead.length} (header columns), got ${row.length}`,
          );
        }
        return row.map((cell, j) => {
          if (typeof cell !== "string") {
            throw new Error(
              `Invalid ${rowPath}[${j}]: must be a string, got ${JSON.stringify(cell)}`,
            );
          }
          return cell;
        });
      });
      return { kind: "conjugation-table", head: parsedHead, rows: parsedRows };
    }
    default:
      throw new Error(
        `Invalid ${path}.kind: unknown block kind, got ${JSON.stringify(kind)}`,
      );
  }
}

export function parseTheoryTopicJson(input: unknown): TheoryTopicJson {
  if (!isObject(input)) {
    throw new Error(
      `Invalid topic: must be an object, got ${describeType(input)}`,
    );
  }
  const id = requireString(input, "id", "");
  const title = requireString(input, "title", "");
  const subtitle = requireString(input, "subtitle", "");
  const cefr = requireString(input, "cefr", "");
  const sectionsRaw = requireNonEmptyArray(input, "sections", "");

  const seen = new Map<string, number>();
  const sections: TheorySectionJson[] = sectionsRaw.map((s, i) => {
    const path = `sections[${i}]`;
    if (!isObject(s)) {
      throw new Error(
        `Invalid ${path}: must be an object, got ${describeType(s)}`,
      );
    }

    const sid = s.id;
    if (sid === undefined) {
      throw new Error(`Invalid ${path}.id: must be present, got undefined`);
    }
    if (typeof sid !== "string" || !SECTION_ID_REGEX.test(sid)) {
      throw new Error(
        `Invalid ${path}.id: must be non-empty kebab-case matching /^[a-z][a-z0-9-]*$/, got ${JSON.stringify(sid)}`,
      );
    }
    const firstIdx = seen.get(sid);
    if (firstIdx !== undefined) {
      throw new Error(
        `Invalid ${path}.id: duplicates sections[${firstIdx}].id (both are ${JSON.stringify(sid)}) — section ids must be unique within a topic`,
      );
    }
    seen.set(sid, i);

    const stitle = requireString(s, "title", path);
    const bodyRaw = requireNonEmptyArray(s, "body", path);
    const body = bodyRaw.map((b, j) => parseBlock(b, `${path}.body[${j}]`));

    return { id: sid, title: stitle, body };
  });

  return { id, title, subtitle, cefr, sections };
}
