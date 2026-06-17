import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import { AuditLogResponseSchema, type AuditQuery } from '../schemas/audit';

export function useAuditLog({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: AuditQuery; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'audit', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/audit${buildQueryString({ ...params })}`);
      const json: unknown = await res.json();
      return AuditLogResponseSchema.parse(json);
    },
    enabled,
  });
}
