import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import LeaderboardClient from '@/components/leaderboard/client';
import { FORMATS, formatLabel, isRatingFormat } from '@/lib/chess';

// Only the three time controls exist; anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return FORMATS.map(({ id }) => ({ format: id }));
}

export async function generateMetadata({ params }: { params: Promise<{ format: string }> }): Promise<Metadata> {
  const { format } = await params;
  if (!isRatingFormat(format)) return {};
  return {
    title: `${formatLabel(format)} leaderboard`,
    description: `IIT Roorkee chess players ranked by Chess.com ${format} rating, updated live.`,
  };
}

export default async function LeaderboardPage({ params }: { params: Promise<{ format: string }> }) {
  const { format } = await params;
  if (!isRatingFormat(format)) notFound();

  // Data is fetched client-side so socket updates can patch it in place.
  // Keyed by format so search and live state reset when switching time control.
  return <LeaderboardClient key={format} format={format} />;
}
