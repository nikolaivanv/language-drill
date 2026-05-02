import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { useScrollSpy } from '../use-scroll-spy';
import { mockIntersectionObserverInstances } from '../../../vitest.setup';

function Harness({ sectionIds }: { sectionIds: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useScrollSpy(sectionIds, ref);
  return (
    <div ref={ref}>
      {sectionIds.map((id) => (
        <div key={id} id={id}>
          {id}
        </div>
      ))}
      <output data-testid="active">{active}</output>
    </div>
  );
}

function fakeEntry(
  id: string,
  ratio: number,
  isIntersecting = true,
): IntersectionObserverEntry {
  const target = document.getElementById(id) as Element;
  return {
    isIntersecting,
    intersectionRatio: ratio,
    target,
  } as IntersectionObserverEntry;
}

describe('useScrollSpy', () => {
  beforeEach(() => {
    mockIntersectionObserverInstances.length = 0;
  });

  it('starts with the first id as active', () => {
    render(<Harness sectionIds={['a', 'b', 'c']} />);
    expect(screen.getByTestId('active').textContent).toBe('a');
  });

  it('returns empty string when there are no sections', () => {
    render(<Harness sectionIds={[]} />);
    expect(screen.getByTestId('active').textContent).toBe('');
  });

  it('updates the active id to the highest-ratio intersecting section', () => {
    render(<Harness sectionIds={['a', 'b', 'c']} />);
    const observer = mockIntersectionObserverInstances.at(-1);
    expect(observer).toBeDefined();

    act(() => {
      observer!.callback(
        [fakeEntry('a', 0.2), fakeEntry('b', 0.8), fakeEntry('c', 0.4)],
        observer as unknown as IntersectionObserver,
      );
    });

    expect(screen.getByTestId('active').textContent).toBe('b');
  });

  it('ignores entries that are not currently intersecting', () => {
    render(<Harness sectionIds={['a', 'b', 'c']} />);
    const observer = mockIntersectionObserverInstances.at(-1)!;

    // 'b' has the highest ratio, but we mark it not intersecting — so 'c' wins.
    act(() => {
      observer.callback(
        [
          fakeEntry('a', 0.1, true),
          fakeEntry('b', 0.9, false),
          fakeEntry('c', 0.5, true),
        ],
        observer as unknown as IntersectionObserver,
      );
    });

    expect(screen.getByTestId('active').textContent).toBe('c');
  });

  it('keeps the previous active id when the callback fires with no intersecting entries', () => {
    render(<Harness sectionIds={['a', 'b', 'c']} />);
    const observer = mockIntersectionObserverInstances.at(-1)!;

    act(() => {
      observer.callback(
        [fakeEntry('b', 0.7, true)],
        observer as unknown as IntersectionObserver,
      );
    });
    expect(screen.getByTestId('active').textContent).toBe('b');

    act(() => {
      observer.callback(
        [fakeEntry('b', 0.0, false)],
        observer as unknown as IntersectionObserver,
      );
    });
    expect(screen.getByTestId('active').textContent).toBe('b');
  });

  it('observes every section element once', () => {
    render(<Harness sectionIds={['a', 'b', 'c']} />);
    const observer = mockIntersectionObserverInstances.at(-1)!;
    expect(observer.observe).toHaveBeenCalledTimes(3);
  });
});
