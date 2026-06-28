import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ShellFooterProvider,
  useShellFooterSuppressed,
  useSuppressShellFooter,
} from './shell-footer-context';

function Reader() {
  return <span data-testid="flag">{String(useShellFooterSuppressed())}</span>;
}

function Suppressor({ active }: { active: boolean }) {
  useSuppressShellFooter(active);
  return null;
}

const flag = () => screen.getByTestId('flag').textContent;

describe('ShellFooterContext', () => {
  it('is not suppressed by default', () => {
    render(
      <ShellFooterProvider>
        <Reader />
      </ShellFooterProvider>,
    );
    expect(flag()).toBe('false');
  });

  it('suppresses while a useSuppressShellFooter(true) consumer is mounted', () => {
    render(
      <ShellFooterProvider>
        <Reader />
        <Suppressor active />
      </ShellFooterProvider>,
    );
    expect(flag()).toBe('true');
  });

  it('does not suppress when active is false', () => {
    render(
      <ShellFooterProvider>
        <Reader />
        <Suppressor active={false} />
      </ShellFooterProvider>,
    );
    expect(flag()).toBe('false');
  });

  it('restores when the suppressor unmounts', () => {
    const { rerender } = render(
      <ShellFooterProvider>
        <Reader />
        <Suppressor active />
      </ShellFooterProvider>,
    );
    expect(flag()).toBe('true');

    rerender(
      <ShellFooterProvider>
        <Reader />
      </ShellFooterProvider>,
    );
    expect(flag()).toBe('false');
  });

  it('restores when active flips back to false', () => {
    const { rerender } = render(
      <ShellFooterProvider>
        <Reader />
        <Suppressor active />
      </ShellFooterProvider>,
    );
    expect(flag()).toBe('true');

    rerender(
      <ShellFooterProvider>
        <Reader />
        <Suppressor active={false} />
      </ShellFooterProvider>,
    );
    expect(flag()).toBe('false');
  });

  it('ref-counts overlapping suppressors', () => {
    const { rerender } = render(
      <ShellFooterProvider>
        <Reader />
        <Suppressor active />
        <Suppressor active />
      </ShellFooterProvider>,
    );
    expect(flag()).toBe('true');

    // Drop one suppressor — still suppressed by the remaining one.
    rerender(
      <ShellFooterProvider>
        <Reader />
        <Suppressor active />
      </ShellFooterProvider>,
    );
    expect(flag()).toBe('true');

    // Drop the last — restored.
    rerender(
      <ShellFooterProvider>
        <Reader />
      </ShellFooterProvider>,
    );
    expect(flag()).toBe('false');
  });

  it('is a no-op (no throw, reports false) without a provider', () => {
    render(
      <>
        <Reader />
        <Suppressor active />
      </>,
    );
    expect(flag()).toBe('false');
  });
});
