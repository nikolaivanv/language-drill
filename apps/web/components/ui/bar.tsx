import * as React from 'react';
import { cn } from '../../lib/cn';

export type BarColor = 'ink' | 'accent' | 'ok';

export interface BarProps {
  value: number;
  max?: number;
  color?: BarColor;
  className?: string;
}

const colorClasses: Record<BarColor, string> = {
  ink: 'bg-ink',
  accent: 'bg-accent',
  ok: 'bg-ok',
};

export function Bar({ value, max = 100, color = 'ink', className }: BarProps) {
  const pct = Math.min(100, (value / max) * 100);

  return (
    <div
      className={cn(
        'h-[6px] bg-paper-3 rounded-pill relative overflow-hidden',
        className
      )}
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className={cn(
          'absolute inset-y-0 left-0 rounded-pill transition-[width] duration-300',
          colorClasses[color]
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
