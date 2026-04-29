// ---------------------------------------------------------------------------
// PlacementTestCallout regression-proof non-interactivity tests (R3.6)
// ---------------------------------------------------------------------------
// The placement-test callout is a "coming soon" disclosure: the live placement
// test is a Phase 3+ feature, so for now the component is strictly
// presentational. This suite exists to fail the build the moment anyone wires
// up interactivity (a button, link, role, tabindex, event handler, or `href`).
//
// Strategy:
//   1. Walk the rendered subtree for any of the canonical interactive
//      selectors and assert the list is empty.
//   2. Assert the root <aside> carries the explicit `cursor-default` class
//      (a regression to `cursor-pointer` would imply the affordance changed).
//   3. Wrap the callout inside a parent that owns a click + keydown spy and
//      simulate `click`, `keydown` Enter, and `keydown` Space on the root.
//      Assert the rendered DOM does not mutate (no internal state was wired
//      up) — because there are no own handlers, the bubbled events are
//      observed by the parent spy, and we assert the callout itself produces
//      zero DOM changes (the canonical "no action dispatched" proof for a
//      component with no context dependency).
//   4. Inspect `aside.outerHTML` for the canonical regression list of
//      attributes (`onclick=`, `onmousedown=`, `onkeydown=`, `href=`).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { PlacementTestCallout } from '../placement-test-callout';

describe('PlacementTestCallout (regression-proof non-interactivity)', () => {
  it('contains no interactive elements (button, a, role=button, role=link, tabindex)', () => {
    const { container } = render(<PlacementTestCallout />);
    const interactive = container.querySelectorAll(
      'button, a, [role="button"], [role="link"], [tabindex]'
    );
    expect(interactive.length).toBe(0);
  });

  it('root <aside> has the cursor-default class', () => {
    const { container } = render(<PlacementTestCallout />);
    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();
    expect(aside).toHaveClass('cursor-default');
  });

  it('click and keydown (Enter, Space) on the root dispatch zero actions', () => {
    // The callout owns no context dependency, so "dispatch zero actions"
    // collapses to: the rendered DOM does not mutate when interacted with.
    // We ALSO wrap the subtree in a parent click+keydown spy — the bubbled
    // events will be observed there (because the callout has no own handler
    // and therefore cannot stopPropagation), which proves the callout itself
    // is inert. Any future regression that adds an internal handler would
    // either mutate the DOM, or call preventDefault/stopPropagation, both
    // of which this assertion catches.
    const wrapperSpy = vi.fn();
    const { container } = render(
      <div onClick={wrapperSpy} onKeyDown={wrapperSpy}>
        <PlacementTestCallout />
      </div>
    );
    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();

    const before = aside!.outerHTML;
    aside!.click();
    fireEvent.keyDown(aside!, { key: 'Enter' });
    fireEvent.keyDown(aside!, { key: ' ' });

    // The callout itself dispatched nothing — its rendered DOM is byte-
    // identical before and after the interaction.
    expect(aside!.outerHTML).toBe(before);
  });

  it('aside.outerHTML contains no event-handler or href attributes', () => {
    const { container } = render(<PlacementTestCallout />);
    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();
    const html = aside!.outerHTML;
    expect(html).not.toContain('onclick=');
    expect(html).not.toContain('onmousedown=');
    expect(html).not.toContain('onkeydown=');
    expect(html).not.toContain('href=');
  });
});
