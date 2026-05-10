import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Requires Clerk JWT template 'api' to include publicMetadata: "{{ user.public_metadata }}"
  const { sessionClaims } = await auth();
  const publicMetadata = sessionClaims?.publicMetadata as
    | { admin?: boolean }
    | undefined;
  if (!publicMetadata?.admin) redirect('/');

  return <>{children}</>;
}
