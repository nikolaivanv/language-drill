import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  LabelQueueResponseSchema,
  LabelingStatsSchema,
  SaveLabelResponseSchema,
  type LabelStratumValue,
  type LabelTagValue,
} from '../schemas/labeling';

export interface LabelingFilters {
  language?: string;
  type?: string;
  grammarPoint?: string;
  nearBoundary?: boolean;
  hasErrors?: boolean;
  scoreMin?: number;
  scoreMax?: number;
  seed?: string;
  limit?: number;
}

function toQuery(stratum: LabelStratumValue, filters: LabelingFilters): string {
  const params = new URLSearchParams({ stratum });
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export function useLabelingQueue({
  fetchFn,
  stratum,
  filters = {},
  enabled = true,
}: {
  fetchFn: AuthenticatedFetch;
  stratum: LabelStratumValue;
  filters?: LabelingFilters;
  enabled?: boolean;
}) {
  const query = toQuery(stratum, filters);
  return useQuery({
    queryKey: ['admin', 'labeling', 'queue', query],
    queryFn: async () => {
      const res = await fetchFn(`/admin/labeling/queue?${query}`);
      const json: unknown = await res.json();
      return LabelQueueResponseSchema.parse(json);
    },
    enabled,
    // A labelled row leaves the queue server-side; refetching mid-session would
    // reshuffle what is on screen under the labeler's hands.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useSaveLabel({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<
    { saved: true; promptVersion: string },
    Error,
    {
      submissionId: string;
      gradeOk: boolean | null;
      feedbackOk: boolean | null;
      stratum: LabelStratumValue;
      tags?: LabelTagValue[];
      critique?: string;
    }
  >({
    mutationFn: async ({ submissionId, ...body }) => {
      const res = await fetchFn(`/admin/labeling/${submissionId}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const json: unknown = await res.json();
      return SaveLabelResponseSchema.parse(json);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'labeling', 'stats'] });
    },
  });
}

export function useLabelingStats({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  return useQuery({
    queryKey: ['admin', 'labeling', 'stats'],
    queryFn: async () => {
      const res = await fetchFn('/admin/labeling/stats');
      const json: unknown = await res.json();
      return LabelingStatsSchema.parse(json);
    },
  });
}
