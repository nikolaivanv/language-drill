'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getConsent, setConsent, type ConsentState } from '../../lib/consent/consent';

type ConsentContextValue = {
  state: ConsentState | null;
  ready: boolean;
  update: (p: { analytics: boolean }) => void;
  openPreferences: () => void;
  closePreferences: () => void;
  preferencesOpen: boolean;
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConsentState | null>(null);
  const [ready, setReady] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  useEffect(() => {
    setState(getConsent());
    setReady(true);
  }, []);

  const update = useCallback((p: { analytics: boolean }) => {
    setState(setConsent(p));
    setPreferencesOpen(false);
  }, []);

  const openPreferences = useCallback(() => setPreferencesOpen(true), []);
  const closePreferences = useCallback(() => setPreferencesOpen(false), []);

  return (
    <ConsentContext.Provider
      value={{ state, ready, update, openPreferences, closePreferences, preferencesOpen }}
    >
      {children}
    </ConsentContext.Provider>
  );
}

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error('useConsent must be used within ConsentProvider');
  return ctx;
}
