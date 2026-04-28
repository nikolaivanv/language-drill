import * as React from 'react';
import { cn } from '../../lib/cn';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps {
  padding?: CardPadding;
  children: React.ReactNode;
  className?: string;
}

const base = 'bg-card border border-rule rounded-r-lg shadow-1';

const paddingClasses: Record<CardPadding, string> = {
  none: 'p-0',
  sm: 'p-s-3',
  md: 'p-s-4',
  lg: 'p-s-6',
};

export function Card({ padding = 'md', children, className }: CardProps) {
  return (
    <div className={cn(base, paddingClasses[padding], className)}>
      {children}
    </div>
  );
}
