import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import DashboardClient from '@/components/dashboard/client';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/auth/signin?callbackUrl=/dashboard');
  }

  return <DashboardClient />;
}
