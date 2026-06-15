# Free Writing Phase 2 — Quick Wins (Design)

_Date: 2026-06-15 · Status: approved, ready to plan_

Scope: the two "Quick wins" from the [Phase 2 roadmap](2026-06-15-free-writing-phase-2.md):
(1) localize the hardcoded Spanish surface chrome, (2) add back-navigation on the
deep surfaces. Both are **purely client-side** in
`apps/web/app/(dashboard)/drill/free-writing/` — no AI, DB, API, or shared-package
changes. The other roadmap items each get their own brainstorm → spec → plan later.

Phase-1 context: [`2026-06-13-free-writing-drill-design.md`](2026-06-13-free-writing-drill-design.md).

---

## Win 1 — Neutralize the hardcoded Spanish chrome to English

**Decision:** neutralize to the app's English UI language (roadmap option a), **not**
per-content-language localization.

Rationale: the rest of the surface chrome is already English ("free writing · your
prompt", "begin writing →", "graded on · IELTS-style", "things to fix", "write
another"); the evaluator returns English headline/summary; the app has no UI-i18n
framework. Per-language tables would add EN/ES/TR/DE translation maps inconsistent
with the rest of the app — YAGNI.

### Exact string changes

| File | Current | New |
|---|---|---|
| `_components/fw-brief.tsx` `SpecRow` label | `tema` | `topic` |
| `_components/fw-brief.tsx` `SpecRow` label | `registro` | `register` |
| `_components/fw-brief.tsx` register guidance | `— dirígete a un lector general; evita coloquialismos.` | `— address a general reader; avoid colloquialisms.` |
| `_components/fw-brief.tsx` `SpecRow` label | `longitud` | `length` |
| `_components/fw-brief.tsx` length unit | `palabras` | `words` |
| `_components/fw-brief.tsx` `SpecRow` label | `elementos obligatorios` | `required elements` |
| `_components/fw-atoms.tsx` `SevTag` map | `{ high: 'alta', med: 'media', low: 'baja' }` | `{ high: 'high', med: 'medium', low: 'low' }` |
| `_components/fw-corrections.tsx` counts row | `{counts.high} alta` / `media` / `baja` | `high` / `medium` / `low` |

### DRY cleanup (serves the goal)

The severity labels are duplicated: once in `SevTag`'s inline map (`fw-atoms.tsx`)
and once as inline strings in the counts row (`fw-corrections.tsx`). Centralize a
single exported constant in `fw-atoms.tsx`:

```ts
export const SEVERITY_LABELS: Record<'high' | 'med' | 'low', string> = {
  high: 'high',
  med: 'medium',
  low: 'low',
};
```

`SevTag` consumes it; `fw-corrections.tsx` imports it for the counts row — so the two
can't drift. The counts row keys (`high`/`med`/`low`) already match this Record's keys.

### Out of scope (noted, not changed)

The register guidance sentence is hardcoded regardless of the actual `register` value
(it says "avoid colloquialisms" even for an informal prompt). That's a pre-existing
content quirk. We translate it faithfully and leave the behavior unchanged.

---

## Win 2 — Back-navigation on the deep surfaces

**Problem:** from `corrections` and `compare` there is no way back except browser-back.
`compare` is reachable from **two** places (`results → compare` and
`corrections → compare`), so a back control that always jumps to `results` is lossy
from the corrections→compare path.

**Decision:** a small history stack in `page.tsx`.

```ts
const [stage, setStage] = useState<Stage>('brief');
const [history, setHistory] = useState<Stage[]>([]);

// Navigate forward, remembering where we came from.
const go = (next: Stage) => {
  setHistory((h) => [...h, stage]);
  setStage(next);
};

// Pop back to the actual previous surface.
const back = () => {
  setHistory((h) => {
    const prev = h[h.length - 1];
    if (prev) setStage(prev);
    return h.slice(0, -1);
  });
};
```

Wiring:

- `onGrade` enters `results` and **resets** `history` to `[]` — so `back()` from a deep
  surface never returns to the already-graded composer.
- `results → corrections`, `results → compare`, `corrections → compare` all use `go(...)`.
- `reset()` ("write another") clears `history` along with the other state.
- `FwCorrections` and `FwCompare` each receive an `onBack` prop and render a back
  control — a `.btn ghost sm` reading `← back`, matching existing button styling —
  near the surface's micro-header.
- `results` keeps "write another" and gets **no** back control (roadmap: only the deep
  surfaces).

The simpler alternative (both surfaces hardcode back→results) is fewer lines but
surprising from the lateral corrections→compare link; rejected.

---

## Testing (TDD — tests first)

Each surface already has a co-located `*.test.tsx`. Extend the existing files:

- `fw-brief.test.tsx`: assert English labels render (`topic`, `register`, `length`,
  `words`, `required elements`) and the Spanish strings (`tema`, `registro`,
  `longitud`, `palabras`, `elementos obligatorios`, `dirígete`) are absent.
- `fw-corrections.test.tsx`: assert the counts row reads `high`/`medium`/`low` (not
  `alta`/`media`/`baja`); assert a back control renders and calls `onBack` on click.
- `fw-compare.test.tsx`: assert a back control renders and calls `onBack` on click.
- `fw-atoms` severity: covered transitively via `fw-corrections` (`SevTag` output);
  add a direct assertion if a `SevTag` test does not already exist.

No new test files — extend the existing ones (project convention).

---

## Out of scope

- Other roadmap items (helpers, pre-gen, progress deltas, exam mode, live element
  detection, drill hub) — separate specs.
- Any AI/prompt/DB/API change. This is web-only.
