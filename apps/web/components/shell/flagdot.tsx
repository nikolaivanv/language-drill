import type { LearningLanguage } from '../../lib/active-language';
import { cn } from '../../lib/cn';

const COLORS: Record<LearningLanguage, string> = {
  ES: 'bg-accent',
  DE: 'bg-[#4b4138]',
  TR: 'bg-[#c01818]',
};

const SIZES = {
  sm: 'w-[24px] h-[24px] text-[10px]',
  md: 'w-[34px] h-[34px] text-[12px]',
} as const;

export function Flagdot({
  language,
  size = 'sm',
  className,
}: {
  language: LearningLanguage;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex items-center justify-center rounded-full font-mono font-semibold text-white flex-shrink-0',
        SIZES[size],
        COLORS[language],
        className
      )}
    >
      {language.toLowerCase()}
    </span>
  );
}
