'use client';

// ---------------------------------------------------------------------------
// ReadTopBar — header above every /read view
// ---------------------------------------------------------------------------
// Left: "reading" eyebrow (t-micro text-ink-mute) over "read & collect"
// (t-display-m, the & wrapped in text-accent).
// Right: current text · history N · + paste · + generate (visually dominant).
// Active tab → aria-current="page" + primary variant.
// On mobile: the actions wrap into a flex-wrap row.
// ---------------------------------------------------------------------------

import { Button } from '../../../../components/ui/button';
import type { View } from '../_state/read-page-reducer';

type Props = {
  view: View;
  onChange: (view: View) => void;
  /** Total entries for the active language. `undefined` shows a "—" placeholder while the query is in flight. */
  historyCount: number | undefined;
};

// Each view "owns" exactly one top-bar button. `empty` re-uses the
// "current text" slot since it is the entries-empty fallback for that view.
function activeButton(view: View): 'current' | 'history' | 'generate' | 'paste' {
  switch (view) {
    case 'annotated':
    case 'empty':
      return 'current';
    case 'history':
      return 'history';
    case 'generating':
      return 'generate';
    case 'pasting':
      return 'paste';
  }
}

export function ReadTopBar({ view, onChange, historyCount }: Props) {
  const active = activeButton(view);

  return (
    <div className="flex items-start justify-between gap-[12px] border-b border-rule pb-[14px] mobile:flex-col">
      <div>
        <div className="t-micro text-ink-mute">reading</div>
        <h1 className="t-display-m mt-[4px]">
          read <span className="text-accent">&amp;</span> collect
        </h1>
      </div>
      <div className="flex items-center gap-[6px] mobile:w-full mobile:flex-wrap">
        <Button
          size="sm"
          variant={active === 'current' ? 'primary' : 'ghost'}
          aria-current={active === 'current' ? 'page' : undefined}
          onClick={() => onChange('annotated')}
        >
          <span className="mobile:hidden">current text</span>
          <span className="hidden mobile:inline">current</span>
        </Button>
        <Button
          size="sm"
          variant={active === 'history' ? 'primary' : 'ghost'}
          aria-current={active === 'history' ? 'page' : undefined}
          onClick={() => onChange('history')}
        >
          history{' '}
          <span className="t-mono ml-[4px] text-[10px] opacity-70">
            {historyCount ?? '—'}
          </span>
        </Button>
        <Button
          size="sm"
          variant={active === 'paste' ? 'primary' : 'ghost'}
          aria-current={active === 'paste' ? 'page' : undefined}
          onClick={() => onChange('pasting')}
        >
          + paste
        </Button>
        <Button
          size="sm"
          variant={active === 'generate' ? 'primary' : 'default'}
          aria-current={active === 'generate' ? 'page' : undefined}
          onClick={() => onChange('generating')}
        >
          + generate
        </Button>
      </div>
    </div>
  );
}
