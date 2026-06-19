import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { submitOnEnter, submitOnModEnter, useAdvanceOnEnter } from '../keyboard';

describe('submitOnEnter (single-line inputs)', () => {
  it('submits on plain Enter and prevents the default', () => {
    const submit = vi.fn();
    const handler = submitOnEnter(submit);
    const preventDefault = vi.fn();
    handler({
      key: 'Enter',
      shiftKey: false,
      preventDefault,
      nativeEvent: { isComposing: false },
    } as unknown as React.KeyboardEvent);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('ignores Shift+Enter, IME composition, and non-Enter keys', () => {
    const submit = vi.fn();
    const handler = submitOnEnter(submit);
    const base = { preventDefault: vi.fn(), nativeEvent: { isComposing: false } };
    handler({ ...base, key: 'Enter', shiftKey: true } as unknown as React.KeyboardEvent);
    handler({
      ...base,
      key: 'Enter',
      shiftKey: false,
      nativeEvent: { isComposing: true },
    } as unknown as React.KeyboardEvent);
    handler({ ...base, key: 'a', shiftKey: false } as unknown as React.KeyboardEvent);
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('submitOnModEnter (multi-line textareas)', () => {
  it('submits on Cmd/Ctrl+Enter but NOT on plain Enter', () => {
    const submit = vi.fn();
    const handler = submitOnModEnter(submit);
    const base = { preventDefault: vi.fn(), nativeEvent: { isComposing: false } };

    handler({ ...base, key: 'Enter', metaKey: false, ctrlKey: false } as unknown as React.KeyboardEvent);
    expect(submit).not.toHaveBeenCalled(); // plain Enter = newline

    handler({ ...base, key: 'Enter', metaKey: true, ctrlKey: false } as unknown as React.KeyboardEvent);
    handler({ ...base, key: 'Enter', metaKey: false, ctrlKey: true } as unknown as React.KeyboardEvent);
    expect(submit).toHaveBeenCalledTimes(2);
  });
});

function AdvanceHarness({ onAdvance }: { onAdvance: () => void }) {
  useAdvanceOnEnter(onAdvance);
  return <button type="button">next</button>;
}

describe('useAdvanceOnEnter', () => {
  it('advances on a plain Enter on the document body', () => {
    const onAdvance = vi.fn();
    render(<AdvanceHarness onAdvance={onAdvance} />);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('ignores auto-repeat (held key) and Shift+Enter', () => {
    const onAdvance = vi.fn();
    render(<AdvanceHarness onAdvance={onAdvance} />);
    fireEvent.keyDown(document.body, { key: 'Enter', repeat: true });
    fireEvent.keyDown(document.body, { key: 'Enter', shiftKey: true });
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('does not fire when Enter lands on a focused button (the button owns it)', () => {
    const onAdvance = vi.fn();
    render(<AdvanceHarness onAdvance={onAdvance} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'next' }), { key: 'Enter' });
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('detaches the listener on unmount', () => {
    const onAdvance = vi.fn();
    const { unmount } = render(<AdvanceHarness onAdvance={onAdvance} />);
    unmount();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onAdvance).not.toHaveBeenCalled();
  });
});
