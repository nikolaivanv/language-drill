import Link from 'next/link';
import { BrandMark } from './brand-mark';

export function Brand() {
  return (
    <Link
      href="/home"
      className="flex items-center gap-s-2 px-s-2 pb-[18px] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(26,22,18,0.08)] rounded-r-sm"
    >
      <BrandMark size={28} />
      <span className="font-display text-[20px] font-semibold tracking-[-0.4px] text-ink">
        drill
      </span>
    </Link>
  );
}
