'use client';

import * as React from 'react';
import { createContext, useContext, useMemo, useState } from 'react';

// The primary CTA an exercise (or FeedbackShell) publishes to the sticky drill
// action bar on mobile. On desktop the same control is rendered inline instead.
export interface DrillPrimaryAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'accent';
}

// Progress meta shown on the left of the action bar ("item N of M").
export interface DrillActionMeta {
  current: number;
  total: number;
}

interface DrillActionContextValue {
  active: boolean;
  primaryAction: DrillPrimaryAction | null;
  setPrimaryAction: (action: DrillPrimaryAction | null) => void;
  meta: DrillActionMeta | null;
  setMeta: (meta: DrillActionMeta | null) => void;
}

// Inert default returned when no provider is present — so exercises render
// their inline CTA on desktop and in unit tests that mount them standalone.
const INERT: DrillActionContextValue = {
  active: false,
  primaryAction: null,
  setPrimaryAction: () => {},
  meta: null,
  setMeta: () => {},
};

const DrillActionContext = createContext<DrillActionContextValue | null>(null);

export function DrillActionProvider({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  const [primaryAction, setPrimaryAction] = useState<DrillPrimaryAction | null>(
    null,
  );
  const [meta, setMeta] = useState<DrillActionMeta | null>(null);

  // `setPrimaryAction`/`setMeta` are stable useState setters, so consumers can
  // depend on them in effects without re-publishing loops.
  const value = useMemo<DrillActionContextValue>(
    () => ({ active, primaryAction, setPrimaryAction, meta, setMeta }),
    [active, primaryAction, meta],
  );

  return (
    <DrillActionContext.Provider value={value}>
      {children}
    </DrillActionContext.Provider>
  );
}

export function useDrillAction(): DrillActionContextValue {
  return useContext(DrillActionContext) ?? INERT;
}
