import { useQuery } from '@tanstack/react-query';
import { HealthResponseSchema, type HealthResponse } from '../schemas/health';

const BASE_URL =
  typeof process !== 'undefined'
    ? (process.env['NEXT_PUBLIC_API_URL'] ?? '')
    : '';

async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${BASE_URL}/health`);
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }
  const json: unknown = await response.json();
  return HealthResponseSchema.parse(json);
}

export function useHealth() {
  return useQuery<HealthResponse, Error>({
    queryKey: ['health'],
    queryFn: fetchHealth,
  });
}
