import type { LearningLanguage } from '../../lib/active-language';
import { cn } from '../../lib/cn';

const COLORS: Record<LearningLanguage, string> = {
  ES: 'bg-accent',
  DE: 'bg-[#4b4138]',
  TR: 'bg-[#c01818]',
};

export function Flagdot({
  language,
  className,
}: {
  language: LearningLanguage;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex items-center justify-center w-[24px] h-[24px] rounded-full font-mono text-[10px] font-semibold text-white flex-shrink-0',
        COLORS[language],
        className
      )}
    >
      {language.toLowerCase()}
    </span>
  );
}
