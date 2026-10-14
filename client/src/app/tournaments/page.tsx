import type { Metadata } from 'next';
import TournamentList from '@/components/tournaments/list';

export const metadata: Metadata = { title: 'Tournaments' };

export default function TournamentsPage() {
  return <TournamentList />;
}
