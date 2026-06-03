import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { RedeemResponseSchema, type RedeemResponse } from '../schemas/invites';

export type RedeemErrorKind = 'invalid' | 'expired' | 'used';

const REDEEM_ERROR_KINDS: readonly RedeemErrorKind[] = [
  'invalid',
  'expired',
  'used',
];

function isRedeemErrorKind(value: unknown): value is RedeemErrorKind {
  return (
    typeof value === 'string' &&
    (REDEEM_ERROR_KINDS as readonly string[]).includes(value)
  );
}

export class RedeemError extends Error {
  kind: RedeemErrorKind;
  constructor(kind: RedeemErrorKind, message: string) {
    super(message);
    this.name = 'RedeemError';
    this.kind = kind;
  }
}

export type UseRedeemInviteParams = {
  fetchFn: AuthenticatedFetch;
};

export function useRedeemInvite({ fetchFn }: UseRedeemInviteParams) {
  const queryClient = useQueryClient();
  return useMutation<RedeemResponse, RedeemError, { code: string }>({
    mutationFn: async ({ code }) => {
      try {
        const response = await fetchFn('/invites/redeem', {
          method: 'POST',
          body: JSON.stringify({ code }),
        });
        const json: unknown = await response.json();
        return RedeemResponseSchema.parse(json);
      } catch (err) {
        // `createAuthenticatedFetch` throws on non-2xx responses, attaching the
        // parsed error body (`{ kind, error }`) as `.body`. Map that into a
        // typed `RedeemError` so callers can branch on `kind`.
        const body = (err as { body?: unknown } | undefined)?.body;
        const rawKind = (body as { kind?: unknown } | undefined)?.kind;
        const kind = isRedeemErrorKind(rawKind) ? rawKind : 'invalid';
        const message =
          (body as { error?: unknown } | undefined)?.error ??
          (err instanceof Error ? err.message : 'Redemption failed');
        throw new RedeemError(
          kind,
          typeof message === 'string' ? message : 'Redemption failed',
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
