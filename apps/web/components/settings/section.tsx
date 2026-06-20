import * as React from 'react';

export function Section({
  id,
  title,
  sub,
  children,
}: {
  id: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={`set-${id}`} className="mb-s-7 scroll-mt-s-6">
      <h2 className="t-display-m mb-s-1">{title}</h2>
      {sub ? <p className="t-body text-ink-soft mb-s-4">{sub}</p> : <div className="h-s-3" />}
      {children}
    </section>
  );
}

export function Row({
  label,
  hint,
  align = 'center',
  children,
}: {
  label: string;
  hint?: string;
  align?: 'center' | 'top';
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        'grid grid-cols-[180px_1fr] gap-s-5 py-s-4 border-b border-rule mobile:grid-cols-1 mobile:gap-s-2 ' +
        (align === 'top' ? 'items-start' : 'items-center')
      }
    >
      <div>
        <div className="text-[13px] font-medium text-ink">{label}</div>
        {hint ? <div className="t-small text-ink-mute mt-[3px]">{hint}</div> : null}
      </div>
      <div>{children}</div>
    </div>
  );
}
