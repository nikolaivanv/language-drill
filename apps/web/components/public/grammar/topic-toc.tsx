'use client';

import { useEffect, useState } from 'react';

/**
 * Anchors are rendered server-side (a client component is still SSR'd), so the
 * TOC works with JS disabled and a crawler sees the section links. The
 * IntersectionObserver only adds the current-section highlight — pure
 * enhancement, never load-bearing for navigation itself.
 */
export function TopicToc({ sections }: { sections: { id: string; title: string }[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const headings = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    for (const h of headings) io.observe(h);
    return () => io.disconnect();
  }, [sections]);

  return (
    // Deliberately NOT sticky itself. The sticky context lives on the parent
    // <aside> in `grammar-topic.tsx`, so this nav and the practise rail below it
    // travel as one block. When the sticky lived here, the nav detached and
    // parked at a fixed offset while its own sibling scrolled underneath it —
    // the TOC rendered straight through the practise card and the sign-up CTA.
    <nav aria-label="On this page">
      <div className="t-mono text-[11px] tracking-[1.6px] text-ink-mute uppercase">
        On this page
      </div>
      <ol className="m-0 mt-s-2 flex list-none flex-col gap-[2px] border-l border-rule p-0">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              aria-current={activeId === s.id ? 'true' : undefined}
              className={
                activeId === s.id
                  ? 'block border-l-2 border-accent py-[7px] pl-[14px] text-ink no-underline'
                  : 'block border-l-2 border-transparent py-[7px] pl-[14px] text-ink-soft no-underline hover:text-ink'
              }
            >
              {s.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
