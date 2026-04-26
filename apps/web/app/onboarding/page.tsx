"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import {
  Language,
  CefrLevel,
  LANGUAGE_NAMES,
  CEFR_DESCRIPTIONS,
} from "@language-drill/shared";
import type { LanguageProfile } from "@language-drill/shared";
import {
  useLanguageProfiles,
  useSaveLanguageProfiles,
  createAuthenticatedFetch,
} from "@language-drill/api-client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANGUAGE_FLAGS: Record<Language, string> = {
  [Language.EN]: "\uD83C\uDDEC\uD83C\uDDE7",
  [Language.ES]: "\uD83C\uDDEA\uD83C\uDDF8",
  [Language.DE]: "\uD83C\uDDE9\uD83C\uDDEA",
  [Language.TR]: "\uD83C\uDDF9\uD83C\uDDF7",
};

const ALL_LANGUAGES = Object.values(Language);
const ALL_CEFR_LEVELS = Object.values(CefrLevel);

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-1/2 rounded bg-gray-200" />
      <div className="grid grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-32 rounded-lg bg-gray-200" />
        ))}
      </div>
    </div>
  );
}

function CefrHelper() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-700"
      >
        <span>What do these levels mean?</span>
        <svg
          className={`h-4 w-4 text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 px-4 py-3">
          <dl className="space-y-2">
            {ALL_CEFR_LEVELS.map((level) => (
              <div key={level} className="flex gap-3 text-sm">
                <dt className="w-8 shrink-0 font-semibold text-gray-700">
                  {level}
                </dt>
                <dd className="text-gray-600">{CEFR_DESCRIPTIONS[level]}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function LanguageCard({
  language,
  selected,
  cefrLevel,
  onToggle,
  onLevelChange,
}: {
  language: Language;
  selected: boolean;
  cefrLevel: CefrLevel;
  onToggle: () => void;
  onLevelChange: (level: CefrLevel) => void;
}) {
  return (
    <div
      className={`cursor-pointer rounded-lg border-2 p-4 transition-colors ${
        selected
          ? "border-blue-500 bg-blue-50"
          : "border-gray-200 bg-white hover:border-gray-300"
      }`}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">{LANGUAGE_FLAGS[language]}</span>
        <span className="text-lg font-medium text-gray-900">
          {LANGUAGE_NAMES[language]}
        </span>
      </div>

      {selected && (
        <div className="mt-3" onClick={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Your level
          </label>
          <select
            value={cefrLevel}
            onChange={(e) => onLevelChange(e.target.value as CefrLevel)}
            className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            {ALL_CEFR_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level} — {CEFR_DESCRIPTIONS[level]}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const fetchFn = useMemo(
    () => createAuthenticatedFetch(getToken),
    [getToken],
  );

  const { data: profilesData, isLoading } = useLanguageProfiles({ fetchFn });
  const saveMutation = useSaveLanguageProfiles({ fetchFn });

  const [selections, setSelections] = useState<Map<Language, CefrLevel>>(
    new Map(),
  );
  const [initialized, setInitialized] = useState(false);

  // Pre-populate state from existing profiles (edit mode)
  useEffect(() => {
    if (initialized || isLoading || !profilesData) return;
    if (profilesData.profiles.length > 0) {
      const map = new Map<Language, CefrLevel>();
      for (const p of profilesData.profiles) {
        map.set(p.language as Language, p.proficiencyLevel as CefrLevel);
      }
      setSelections(map);
    }
    setInitialized(true);
  }, [profilesData, isLoading, initialized]);

  const isEditMode =
    profilesData !== undefined && profilesData.profiles.length > 0;

  const toggleLanguage = (lang: Language) => {
    setSelections((prev) => {
      const next = new Map(prev);
      if (next.has(lang)) {
        next.delete(lang);
      } else {
        next.set(lang, CefrLevel.B1);
      }
      return next;
    });
  };

  const setLevel = (lang: Language, level: CefrLevel) => {
    setSelections((prev) => {
      const next = new Map(prev);
      next.set(lang, level);
      return next;
    });
  };

  const handleSave = () => {
    const profiles: LanguageProfile[] = Array.from(selections.entries()).map(
      ([language, proficiencyLevel]) => ({ language, proficiencyLevel }),
    );
    saveMutation.mutate(profiles, {
      onSuccess: () => {
        router.push("/");
      },
    });
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <LoadingSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-2 text-2xl font-bold">
        {isEditMode ? "Edit your languages" : "Set up your languages"}
      </h1>
      <p className="mb-6 text-gray-600">
        Select the languages you want to practice and your current level in
        each.
      </p>

      <div className="mb-6 grid grid-cols-2 gap-4">
        {ALL_LANGUAGES.map((lang) => (
          <LanguageCard
            key={lang}
            language={lang}
            selected={selections.has(lang)}
            cefrLevel={selections.get(lang) ?? CefrLevel.B1}
            onToggle={() => toggleLanguage(lang)}
            onLevelChange={(level) => setLevel(lang, level)}
          />
        ))}
      </div>

      <div className="mb-6">
        <CefrHelper />
      </div>

      {saveMutation.error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-medium">Failed to save</p>
          <p className="mt-1">{saveMutation.error.message}</p>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={selections.size === 0 || saveMutation.isPending}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
      >
        {saveMutation.isPending
          ? "Saving..."
          : isEditMode
            ? "Save changes"
            : "Start practicing"}
      </button>
    </div>
  );
}
