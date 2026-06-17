'use client';

import * as React from 'react';
import { useFlagExercise } from '@language-drill/api-client';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { Button } from '../../../../components/ui';

const CATEGORIES: { value: 'wrong_answer' | 'misleading_explanation' | 'confusing_prompt' | 'other'; label: string }[] = [
  { value: 'wrong_answer', label: 'The accepted answer is wrong' },
  { value: 'misleading_explanation', label: 'The explanation is wrong or misleading' },
  { value: 'confusing_prompt', label: 'The prompt is confusing' },
  { value: 'other', label: 'Something else' },
];

export interface FlagExerciseControlProps {
  exerciseId: string;
  submissionId: string;
  fetchFn: AuthenticatedFetch;
}

export function FlagExerciseControl({ exerciseId, submissionId, fetchFn }: FlagExerciseControlProps) {
  const [open, setOpen] = React.useState(false);
  const [category, setCategory] = React.useState<typeof CATEGORIES[number]['value']>('wrong_answer');
  const [note, setNote] = React.useState('');
  const flag = useFlagExercise({ fetchFn });

  if (flag.isSuccess) {
    return <p className="t-small text-ink-mute mt-s-3">Thanks — flagged for review.</p>;
  }

  if (!open) {
    return (
      <div className="mt-s-3 flex justify-end">
        <button
          type="button"
          className="t-small text-ink-mute underline underline-offset-2 hover:text-ink"
          onClick={() => setOpen(true)}
        >
          Flag this exercise
        </button>
      </div>
    );
  }

  return (
    <div className="mt-s-3 rounded-lg bg-paper-2 p-s-4">
      <p className="t-small font-medium">What&apos;s wrong with this exercise?</p>
      <fieldset className="mt-s-3 flex flex-col gap-s-2">
        <legend className="sr-only">What&apos;s wrong with this exercise?</legend>
        {CATEGORIES.map((cat) => (
          <label key={cat.value} className="t-small flex items-center gap-s-2">
            <input
              type="radio"
              name="flag-category"
              value={cat.value}
              checked={category === cat.value}
              onChange={() => setCategory(cat.value)}
            />
            {cat.label}
          </label>
        ))}
      </fieldset>
      <label className="t-small mt-s-3 block">
        Note (optional)
        <textarea
          className="mt-s-1 w-full rounded-md bg-paper-1 p-s-2 t-small"
          rows={2}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {flag.isError && <p className="t-small text-[var(--color-accent)] mt-s-2">Couldn&apos;t submit — try again.</p>}
      <div className="mt-s-3 flex justify-end gap-s-2">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={flag.isPending}>Cancel</Button>
        <Button
          variant="accent"
          disabled={flag.isPending}
          onClick={() => flag.mutate({ exerciseId, submissionId, category, note: note.trim() || undefined }, { onSuccess: () => setOpen(false) })}
        >
          Submit flag
        </Button>
      </div>
    </div>
  );
}
