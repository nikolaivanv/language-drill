import * as React from 'react';
import { cn } from '../../lib/cn';

/**
 * Lightweight styled table primitives for the admin surface. They give every
 * admin table a consistent treatment: left-aligned headers in muted ink,
 * hairline row rules, and even cell padding — so columns line up instead of
 * the browser's default auto-sized, center-aligned `<th>` layout.
 *
 * Numeric columns pass `align="right"` to keep counts flush.
 */

export function DataTable({ className, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-md border border-rule bg-card">
      <table className={cn('w-full border-collapse text-[13px]', className)} {...rest} />
    </div>
  );
}

type CellAlign = 'left' | 'right';
const alignClass: Record<CellAlign, string> = { left: 'text-left', right: 'text-right' };

export function Th({
  align = 'left',
  className,
  ...rest
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: CellAlign }) {
  return (
    <th
      className={cn(
        'border-b border-rule bg-paper-2 px-3 py-2 font-medium text-ink-soft whitespace-nowrap',
        alignClass[align],
        className,
      )}
      {...rest}
    />
  );
}

export function Td({
  align = 'left',
  className,
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: CellAlign }) {
  return (
    <td
      className={cn(
        'border-b border-rule px-3 py-2 align-middle text-ink',
        alignClass[align],
        className,
      )}
      {...rest}
    />
  );
}
