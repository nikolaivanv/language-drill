import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnnotatedSkeleton } from '../annotated-skeleton';

// ---------------------------------------------------------------------------
// AnnotatedSkeleton — chip + shimmer spans, deterministic widths.
// (Requirement 11.1)
// ---------------------------------------------------------------------------

describe('AnnotatedSkeleton', () => {
  it('renders the "annotating…" chip near the title', () => {
    render(<AnnotatedSkeleton />);
    expect(screen.getByText('annotating…')).toBeInTheDocument();
  });

  it('renders at least one shimmer span for the text body', () => {
    render(<AnnotatedSkeleton />);
    const spans = screen.getAllByTestId('shimmer-span');
    expect(spans.length).toBeGreaterThanOrEqual(1);
  });

  it('uses deterministic widths so SSR/hydration agree (two renders match)', () => {
    const a = render(<AnnotatedSkeleton />);
    const widthsA = a.getAllByTestId('shimmer-span').map((el) =>
      (el as HTMLElement).style.width,
    );
    a.unmount();

    const b = render(<AnnotatedSkeleton />);
    const widthsB = b.getAllByTestId('shimmer-span').map((el) =>
      (el as HTMLElement).style.width,
    );
    expect(widthsB).toEqual(widthsA);
  });

  it('every shimmer width is in the [40px, 100px] range', () => {
    render(<AnnotatedSkeleton />);
    const spans = screen.getAllByTestId('shimmer-span');
    for (const span of spans) {
      const px = parseInt((span as HTMLElement).style.width, 10);
      expect(px).toBeGreaterThanOrEqual(40);
      expect(px).toBeLessThanOrEqual(100);
    }
  });
});
