import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';

export default async function DashboardPage() {
  const { userId } = await auth();

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Welcome</h1>
      <p className="mb-8 text-gray-600">
        Ready to practice? Pick a language and difficulty level to get started.
      </p>
      <Link
        href="/practice"
        className="inline-block rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
      >
        Start Practice
      </Link>
    </div>
  );
}
