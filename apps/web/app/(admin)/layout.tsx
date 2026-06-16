import { redirect } from 'next/navigation';
import { MeResponseSchema } from '@language-drill/api-client';
import { apiFetch } from '../../lib/api-server';
import { AdminShell } from '../../components/admin/admin-shell';

// Admin access is gated on `GET /me`'s `isAdmin` flag, which the API derives
// from the ADMIN_USER_IDS env var — the single source of truth. The API's
// adminMiddleware is the real security boundary; this gate is UX only.
// `publicMetadata.admin` is no longer consulted (the old (dashboard)/admin
// gate that read it has been removed).
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let res: Response;
  try {
    res = await apiFetch('/me');
  } catch {
    redirect('/');
  }
  if (!res.ok) redirect('/');

  const me = MeResponseSchema.parse(await res.json());
  if (!me.isAdmin) redirect('/');

  return <AdminShell>{children}</AdminShell>;
}
