const SHARED_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  xmlns: 'http://www.w3.org/2000/svg',
};

export function TodayIcon() {
  return (
    <svg {...SHARED_PROPS} aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5" />
      <path d="M8 13v1.5" />
      <path d="M1.5 8h1.5" />
      <path d="M13 8h1.5" />
      <path d="M3.4 3.4l1 1" />
      <path d="M11.6 11.6l1 1" />
      <path d="M3.4 12.6l1-1" />
      <path d="M11.6 4.4l1-1" />
    </svg>
  );
}

export function DrillIcon() {
  return (
    <svg {...SHARED_PROPS} aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M6.5 5.5l4 2.5-4 2.5z" />
    </svg>
  );
}

export function ReadIcon() {
  return (
    <svg {...SHARED_PROPS} aria-hidden="true">
      <path d="M2 3.5h4.5a1.5 1.5 0 0 1 1.5 1.5v8a1 1 0 0 0-1-1H2z" />
      <path d="M14 3.5H9.5A1.5 1.5 0 0 0 8 5v8a1 1 0 0 1 1-1h5z" />
    </svg>
  );
}

export function ProgressIcon() {
  return (
    <svg {...SHARED_PROPS} aria-hidden="true">
      <path d="M3 13V9" />
      <path d="M8 13V6" />
      <path d="M13 13V3" />
      <path d="M2 14h12" />
    </svg>
  );
}

// A 2×2 grid / catalog glyph for the theory library — deliberately distinct
// from the open-book ReadIcon so "theory" and "read" read differently in the
// nav.
export function TheoryIcon() {
  return (
    <svg {...SHARED_PROPS} aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  );
}
