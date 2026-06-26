'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useClerk, useUser } from '@clerk/nextjs';
import { ThemeToggle } from '../theme/theme-toggle';

function getInitials(
  firstName?: string | null,
  lastName?: string | null,
  email?: string | null
): string {
  const f = firstName?.[0];
  const l = lastName?.[0];
  if (f && l) return (f + l).toUpperCase();
  if (f) return f.toUpperCase();
  // Passwordless / OTP signups have no name — fall back to the first letter
  // of the email so the avatar never renders a bare "?".
  const e = email?.trim()[0];
  if (e) return e.toUpperCase();
  return '?';
}

export function UserFooter() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!isLoaded) {
    return (
      <div className="mt-auto flex items-center gap-s-3 px-s-2 pt-[18px] border-t border-rule">
        <div className="w-[40px] h-[40px] rounded-full bg-paper-2 animate-pulse" />
        <div className="flex-1 h-3 bg-paper-2 rounded animate-pulse" />
      </div>
    );
  }

  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const initials = getInitials(user?.firstName, user?.lastName, email);
  // Prefer a real first name; otherwise the email's local part (so the label
  // matches the avatar letter); finally a friendly default.
  const name = user?.firstName ?? email?.split('@')[0] ?? 'you';

  return (
    <div ref={ref} className="relative mt-auto pt-[18px] border-t border-rule">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-full flex items-center gap-s-3 px-s-2 py-s-2 rounded-md hover:bg-paper-2 transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--ring-app)]"
      >
        <span className="w-[40px] h-[40px] rounded-full bg-accent-soft text-accent-2 font-display text-[15px] font-semibold flex items-center justify-center flex-shrink-0">
          {initials}
        </span>
        <span className="flex-1 text-left text-[15px] text-ink-2 font-medium truncate">
          {name.toLowerCase()}
        </span>
        <span className="text-ink-mute text-[18px] leading-none" aria-hidden="true">
          ⋯
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 right-0 mb-1 z-10 bg-card border border-rule rounded-md shadow-2 py-1"
        >
          <ThemeToggle className="px-s-1 pt-s-1 pb-s-2" />
          <div className="my-1 mx-s-2 h-px bg-rule" />
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-s-3 py-s-2 text-[14px] text-ink hover:bg-paper-2 transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--ring-app)]"
          >
            settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => signOut({ redirectUrl: '/sign-in' })}
            className="w-full text-left px-s-3 py-s-2 text-[14px] text-ink hover:bg-paper-2 transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--ring-app)]"
          >
            sign out
          </button>
        </div>
      )}
    </div>
  );
}
