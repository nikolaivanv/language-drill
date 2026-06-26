'use client';

export const SETTINGS_SECTIONS = [
  { id: 'languages', label: 'languages & levels' },
  { id: 'goals', label: 'goals' },
  { id: 'plan', label: 'plan & limits' },
  { id: 'account', label: 'account' },
  { id: 'email', label: 'email notifications' },
  { id: 'privacy', label: 'privacy & data' },
] as const;

export function SettingsNav({
  activeId,
  onJump,
}: {
  activeId: string;
  onJump: (id: string) => void;
}) {
  return (
    <aside className="sticky top-s-6 self-start mobile:hidden">
      <div className="t-micro text-ink-mute mb-s-3">settings</div>
      <ul className="flex flex-col gap-[2px] list-none p-0 m-0">
        {SETTINGS_SECTIONS.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onJump(s.id)}
              className={
                'w-full text-left px-s-3 py-[8px] rounded-sm text-[14px] border-l-2 transition-all duration-150 ' +
                (activeId === s.id
                  ? 'text-ink border-accent font-medium'
                  : 'text-ink-soft border-transparent hover:text-ink hover:bg-paper-2 hover:border-rule-strong')
              }
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-s-5 pt-s-4 border-t border-dashed border-rule t-micro text-ink-mute leading-relaxed">
        changes save as you make them.
      </div>
    </aside>
  );
}
