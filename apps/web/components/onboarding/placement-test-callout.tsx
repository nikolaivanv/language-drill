// ---------------------------------------------------------------------------
// PlacementTestCallout
// ---------------------------------------------------------------------------
// The disabled "coming soon" placement-test disclosure rendered inside
// `StepLevel`. Strictly non-interactive: the live placement test is a Phase 3+
// feature, so for now we acknowledge the question without offering an action.
//
// Non-interactivity contract (R3.6) — DO NOT add any of the following:
//   * `<button>`, `<a>`, `<input>`, `<textarea>`, or `<select>` elements.
//   * `role="button"`, `role="link"`, or any other interactive ARIA role.
//   * `onClick`, `onKeyDown`, `onMouseDown`, or any event handler.
//   * `tabIndex` (any value) or `href` attributes.
//   * `cursor-pointer` (we explicitly use `cursor-default`).
//
// The component is pure presentational and server-renderable, so no
// `'use client'` directive is needed. The `__tests__/placement-test-callout.test.tsx`
// regression suite (task 21) walks the rendered subtree and fails the build if
// any of the above sneak in.
// ---------------------------------------------------------------------------

export function PlacementTestCallout() {
  return (
    <aside
      role="note"
      data-testid="placement-test-callout"
      className="cursor-default rounded-md border border-dashed border-rule bg-paper-2 p-s-4"
    >
      <div className="t-hand text-ink">not sure?</div>
      <p className="t-small text-ink-mute mt-s-1">
        a 5-min adaptive placement test is coming soon — for now, pick the band that feels closest.
      </p>
    </aside>
  );
}
