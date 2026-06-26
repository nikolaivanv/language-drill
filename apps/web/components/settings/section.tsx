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
    <section id={`set-${id}`} className="mb-[56px] scroll-mt-s-6">
      <h2 className="t-display-m mb-s-1">{title}</h2>
      {sub ? <p className="text-[15px] leading-relaxed text-ink-soft mb-s-5">{sub}</p> : <div className="h-s-4" />}
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
        'grid grid-cols-[220px_1fr] gap-x-[40px] py-s-5 border-b border-rule mobile:grid-cols-1 mobile:gap-x-0 mobile:gap-y-s-3 ' +
        (align === 'top' ? 'items-start' : 'items-center')
      }
    >
      <div>
        <div className="text-[15px] font-semibold text-ink leading-snug">{label}</div>
        {hint ? <div className="t-small text-ink-mute mt-[4px] leading-relaxed">{hint}</div> : null}
      </div>
      <div>{children}</div>
    </div>
  );
}
