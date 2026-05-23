import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { useFocusTrap } from '../use-focus-trap';

function Harness({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(active, ref);
  return (
    <div ref={ref}>
      <button>first</button>
      <button>second</button>
      <button>third</button>
    </div>
  );
}

// Sheets (word card, paste) render form fields, so the widened selector must
// treat inputs and textareas as focusable.
function FormHarness() {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(true, ref);
  return (
    <div ref={ref}>
      <input type="hidden" defaultValue="ignored" />
      <input aria-label="name" />
      <textarea aria-label="notes" />
    </div>
  );
}

describe('useFocusTrap', () => {
  it('focuses the first focusable element on activation', () => {
    const { container } = render(<Harness active={true} />);
    const buttons = container.querySelectorAll('button');
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('wraps focus from the last element to the first on Tab', () => {
    const { container } = render(<Harness active={true} />);
    const buttons = container.querySelectorAll('button');
    const last = buttons[buttons.length - 1] as HTMLButtonElement;
    last.focus();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('wraps focus from the first element to the last on Shift+Tab', () => {
    const { container } = render(<Harness active={true} />);
    const buttons = container.querySelectorAll('button');
    const first = buttons[0] as HTMLButtonElement;
    first.focus();
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it('does nothing for non-Tab keys', () => {
    const { container } = render(<Harness active={true} />);
    const buttons = container.querySelectorAll('button');
    (buttons[1] as HTMLButtonElement).focus();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(document.activeElement).toBe(buttons[1]);
  });

  it('does not auto-focus or intercept Tab when inactive', () => {
    // Place focus on something outside the trap before render.
    const outside = document.createElement('button');
    outside.textContent = 'outside';
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    render(<Harness active={false} />);
    expect(document.activeElement).toBe(outside);

    // Tab keydown should not be intercepted.
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(outside);

    document.body.removeChild(outside);
  });

  it('traps focus on input and textarea fields, skipping hidden inputs', () => {
    render(<FormHarness />);
    const input = screen.getByLabelText('name');
    const textarea = screen.getByLabelText('notes');

    // The first non-hidden focusable (the text input) is auto-focused.
    expect(document.activeElement).toBe(input);

    // Tab from the last focusable (the textarea) wraps back to the input —
    // proving textarea is recognized as focusable and the hidden input is not.
    textarea.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(input);
  });
});
