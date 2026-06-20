'use client';

import { UserProfile } from '@clerk/nextjs';
import { Section } from './section';

export function AccountSection() {
  return (
    <Section id="account" title="account" sub="how you sign in and what's tied to your identity.">
      <UserProfile
        routing="hash"
        appearance={{
          variables: {
            colorPrimary: '#c96442',
            colorText: '#1a1612',
            borderRadius: '8px',
            fontFamily: 'var(--t-sans, Inter, sans-serif)',
          },
          elements: {
            rootBox: 'w-full',
            card: 'shadow-none border border-rule',
          },
        }}
      />
    </Section>
  );
}
