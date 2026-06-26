'use client';

import { UserProfile } from '@clerk/nextjs';
import { Section } from './section';
import { useTheme } from '../theme/theme-provider';

export function AccountSection() {
  // The Clerk widget is a third-party iframe-less component whose colours come
  // from `appearance.variables` (it doesn't read our CSS custom properties), so
  // we feed it concrete light/dark values keyed off the resolved theme —
  // otherwise the widget renders dark text on our dark card.
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';

  return (
    <Section id="account" title="account" sub="how you sign in and what's tied to your identity.">
      <UserProfile
        routing="hash"
        appearance={{
          variables: {
            colorPrimary: dark ? '#e0856a' : '#c96442',
            colorBackground: dark ? '#26211a' : '#ffffff',
            colorText: dark ? '#f6efe4' : '#1a1612',
            colorTextSecondary: dark ? '#a89d8b' : '#8a8074',
            colorInputBackground: dark ? '#16130f' : '#ffffff',
            colorInputText: dark ? '#f6efe4' : '#1a1612',
            borderRadius: '10px',
            fontFamily: 'var(--font-ui, Inter, sans-serif)',
          },
          elements: {
            rootBox: 'w-full',
            card: 'shadow-1 border border-rule rounded-lg',
          },
        }}
      />
    </Section>
  );
}
