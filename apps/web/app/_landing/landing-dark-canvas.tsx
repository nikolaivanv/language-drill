'use client';

import { useEffect } from 'react';

// The landing fills the viewport with the dark --df-bg, but the document body is
// light (--color-paper), so the browser's overscroll "rubber-band" at the very
// top/bottom reveals white edges (the canvas propagates from the body's
// background). While the landing is mounted, mark <html> so the canvas paints
// dark instead; revert on navigation away to any (light) app page.
export function LandingDarkCanvas() {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('landing-dark');
    return () => html.classList.remove('landing-dark');
  }, []);
  return null;
}
