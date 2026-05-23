import { useEffect, useState, type RefObject } from 'react';

// Single-IntersectionObserver scroll-spy. Returns the id of the section
// currently most visible inside `scrollRef`'s viewport. The viewport is
// shrunk by 20% from the top and 60% from the bottom so a section becomes
// "active" when its top reaches the upper portion of the panel — matching
// the prototype's reading-region heuristic.
export function useScrollSpy(
  sectionIds: string[],
  scrollRef: RefObject<HTMLElement | null>,
): string {
  const [activeId, setActiveId] = useState<string>(sectionIds[0] ?? '');

  // Use the joined ids as a stable dep so the effect re-runs only when the
  // section set actually changes (not on every render with a fresh array).
  const idsKey = sectionIds.join('|');

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || sectionIds.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        root,
        rootMargin: '-20% 0px -60% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    for (const id of sectionIds) {
      const el = root.querySelector(`#${CSS.escape(id)}`);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [idsKey, scrollRef]);

  return activeId;
}
