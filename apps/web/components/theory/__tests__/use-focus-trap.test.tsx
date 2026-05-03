import { describe, it, expect } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
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
});
