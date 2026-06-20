import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SettingsPage from '../page';

// ---------------------------------------------------------------------------
// Mock heavy section components so the page test doesn't pull in Clerk /
// api-client / network requests.
// ---------------------------------------------------------------------------

vi.mock('../../../../components/settings/languages-section', () => ({
  LanguagesSection: () => <section id="set-languages">languages-section</section>,
}));

vi.mock('../../../../components/settings/goals-section', () => ({
  GoalsSection: () => <section id="set-goals">goals-section</section>,
}));

vi.mock('../../../../components/settings/plan-and-limits', () => ({
  PlanAndLimits: () => <section id="set-plan">plan-and-limits</section>,
}));

vi.mock('../../../../components/settings/account-section', () => ({
  AccountSection: () => <section id="set-account">account-section</section>,
}));

// ---------------------------------------------------------------------------
// SettingsNav is also mocked so it doesn't need Clerk either.
// We re-export SETTINGS_SECTIONS from a real-ish stub so the page can still
// reference it for the IntersectionObserver setup.
// ---------------------------------------------------------------------------

vi.mock('../../../../components/settings/settings-nav', () => ({
  SETTINGS_SECTIONS: [
    { id: 'languages', label: 'languages & levels' },
    { id: 'goals', label: 'goals' },
    { id: 'plan', label: 'plan & limits' },
    { id: 'account', label: 'account' },
  ],
  SettingsNav: ({
    onJump,
  }: {
    activeId: string;
    onJump: (id: string) => void;
  }) => (
    <nav>
      <button type="button" onClick={() => onJump('languages')}>
        languages & levels
      </button>
      <button type="button" onClick={() => onJump('goals')}>
        goals
      </button>
      <button type="button" onClick={() => onJump('plan')}>
        plan & limits
      </button>
      <button type="button" onClick={() => onJump('account')}>
        account
      </button>
    </nav>
  ),
}));

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderSettings() {
  return render(<SettingsPage />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsPage', () => {
  it('renders the nav and all four sections', () => {
    renderSettings();
    expect(screen.getByRole('button', { name: /languages & levels/i })).toBeInTheDocument();
    expect(document.getElementById('set-languages')).toBeInTheDocument();
    expect(document.getElementById('set-goals')).toBeInTheDocument();
    expect(document.getElementById('set-plan')).toBeInTheDocument();
    expect(document.getElementById('set-account')).toBeInTheDocument();
  });
});
