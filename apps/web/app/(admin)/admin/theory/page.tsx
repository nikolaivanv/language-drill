import { redirect } from 'next/navigation';

export default function AdminTheoryRedirect() {
  redirect('/admin/pool?tab=theory');
}
