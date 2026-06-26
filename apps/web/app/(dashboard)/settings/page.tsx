'use client';

import { useCallback, useEffect, useState } from 'react';
import { SettingsNav, SETTINGS_SECTIONS } from '../../../components/settings/settings-nav';
import { LanguagesSection } from '../../../components/settings/languages-section';
import { GoalsSection } from '../../../components/settings/goals-section';
import { PlanAndLimits } from '../../../components/settings/plan-and-limits';
import { AccountSection } from '../../../components/settings/account-section';
import { PrivacyDataSection } from '../../../components/settings/privacy-data-section';
import { EmailSection } from '../../../components/settings/email-section';

export default function SettingsPage() {
  const [active, setActive] = useState<string>(SETTINGS_SECTIONS[0].id);

  useEffect(() => {
    const els = SETTINGS_SECTIONS
      .map((s) => document.getElementById(`set-${s.id}`))
      .filter((el): el is HTMLElement => el !== null);
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id.replace('set-', ''));
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const jumpTo = useCallback((id: string) => {
    document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  }, []);

  return (
    <div className="mx-auto max-w-[1040px] grid grid-cols-[180px_1fr] gap-x-[48px] py-s-4 mobile:grid-cols-1 mobile:gap-x-0 mobile:py-0">
      <SettingsNav activeId={active} onJump={jumpTo} />
      <div className="min-w-0">
        <h1 className="t-display-l mb-s-2">settings</h1>
        <p className="t-body-l text-ink-soft mb-s-8">tune the things that make this <em>your</em> drill.</p>
        <LanguagesSection />
        <GoalsSection />
        <PlanAndLimits />
        <AccountSection />
        <EmailSection />
        <PrivacyDataSection />
      </div>
    </div>
  );
}
