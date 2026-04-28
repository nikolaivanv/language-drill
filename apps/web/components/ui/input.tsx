import * as React from 'react';
import { cn } from '../../lib/cn';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  className?: string;
};

const base =
  'w-full px-[14px] py-[12px] border border-rule rounded-r-md bg-card text-[14px] text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:border-ink focus:shadow-[0_0_0_3px_rgba(26,22,18,0.08)]';

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(base, className)} {...rest} />;
  }
);
