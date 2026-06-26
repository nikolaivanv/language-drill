import * as React from 'react';
import { cn } from '../../lib/cn';

export type ChipVariant = 'default' | 'solid' | 'accent' | 'ok';

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: ChipVariant;
  children: React.ReactNode;
}

const shared =
  'inline-flex items-center gap-1 px-[9px] py-[3px] rounded-pill text-[11px] font-medium';

const variantClasses: Record<ChipVariant, string> = {
  default: 'border border-rule bg-paper text-ink-soft',
  solid: 'border border-ink bg-ink text-paper',
  accent: 'border border-accent-soft bg-accent-soft text-accent-2',
  ok: 'border border-ok-soft bg-ok-soft text-ok',
};

export function Chip({
  variant = 'default',
  children,
  className,
  ...rest
}: ChipProps) {
  return (
    <span
      {...rest}
      className={cn(shared, variantClasses[variant], className)}
    >
      {children}
    </span>
  );
}
