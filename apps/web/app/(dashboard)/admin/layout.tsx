import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Requires the Clerk *session token* (not the 'api' JWT template) to include
  // publicMetadata. Configure in the Clerk dashboard → Sessions → "Customize
  // session token" with: { "publicMetadata": "{{user.public_metadata}}" }.
  // The 'api' JWT template is used by getToken({ template: 'api' }) for the
  // Lambda authorizer; it does not affect auth() here.
  const { sessionClaims } = await auth();
  const publicMetadata = sessionClaims?.publicMetadata as
    | { admin?: boolean }
    | undefined;
  if (!publicMetadata?.admin) redirect('/');

  return <>{children}</>;
}
