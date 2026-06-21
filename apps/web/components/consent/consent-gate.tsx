'use client';

import { useConsent } from './consent-provider';

export function ConsentGate({
  category,
  children,
}: {
  category: 'analytics';
  children: React.ReactNode;
}) {
  const { state } = useConsent();
  if (state?.[category] !== true) return null;
  return <>{children}</>;
}
