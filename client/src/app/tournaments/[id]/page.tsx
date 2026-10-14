import type { Metadata } from 'next';
import TournamentDetail from '@/components/tournaments/detail';

export const metadata: Metadata = { title: 'Tournament' };

export default async function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TournamentDetail id={id} />;
}
