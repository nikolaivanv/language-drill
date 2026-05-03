import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

// Inline highlights ─────────────────────────────────────────────────────────

export function Hilite({ children }: { children: ReactNode }) {
  return <span className="hilite">{children}</span>;
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="t-mono">{children}</span>;
}

// Callout ───────────────────────────────────────────────────────────────────

type CalloutVariant = 'default' | 'warn';

export function Callout({
  variant = 'default',
  children,
}: {
  variant?: CalloutVariant;
  children: ReactNode;
}) {
  return (
    <div className={cn('callout', variant === 'warn' && 'warn')}>
      {children}
    </div>
  );
}

// Example block (with .ES / .EN / .Note sub-components) ─────────────────────

export function Example({ children }: { children: ReactNode }) {
  return <div className="example">{children}</div>;
}

Example.ES = function ExampleES({ children }: { children: ReactNode }) {
  return <div className="example-es">{children}</div>;
};

Example.EN = function ExampleEN({ children }: { children: ReactNode }) {
  return <div className="example-en">{children}</div>;
};

Example.Note = function ExampleNote({ children }: { children: ReactNode }) {
  return <div className="example-note">{children}</div>;
};

// Theory list ───────────────────────────────────────────────────────────────

export function TheoryList({ children }: { children: ReactNode }) {
  return <ul className="theory-list">{children}</ul>;
}

// Conjugation table — authors compose <thead>/<tbody>/<tr>/<th>/<td> inside.
// Keeping it a thin <table> wrapper avoids forcing every table to share one
// shape, since irregular-verb tables, signal-word tables, and aspect tables
// all have different column counts.

export function ConjugationTable({ children }: { children: ReactNode }) {
  return <table className="theory-table">{children}</table>;
}
