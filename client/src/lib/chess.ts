import type { ChessProfile, RatingFormat } from '@/types';

export const FORMATS: readonly { id: RatingFormat; label: string }[] = [
  { id: 'rapid', label: 'Rapid' },
  { id: 'blitz', label: 'Blitz' },
  { id: 'bullet', label: 'Bullet' },
];

export function isRatingFormat(value: string): value is RatingFormat {
  return FORMATS.some((f) => f.id === value);
}

export function formatLabel(format: RatingFormat): string {
  return FORMATS.find((f) => f.id === format)?.label ?? format;
}

export function getRating(profile: ChessProfile, format: RatingFormat): number | null {
  if (format === 'rapid') return profile.rapidRating;
  if (format === 'blitz') return profile.blitzRating;
  return profile.bulletRating;
}

export function playerName(profile: Pick<ChessProfile, 'username' | 'displayName' | 'user'>): string {
  return profile.user?.name || profile.displayName || profile.username;
}

export function chessComUrl(username: string): string {
  return `https://www.chess.com/member/${encodeURIComponent(username)}`;
}

/** Tournament points with a proper half: 2.5 -> "2½", 0.5 -> "½". */
export function formatScore(score: number): string {
  const whole = Math.floor(score);
  const half = score - whole >= 0.5;
  if (!half) return String(whole);
  return whole === 0 ? '½' : `${whole}½`;
}

/** The leaderboard is limited to institute accounts; the API enforces the same rule. */
export const INSTITUTE_EMAIL_DOMAIN = '@iitr.ac.in';

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 23 -> "23rd". */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/**
 * Standard competition ranking ("1224"): equal ratings share a rank and the
 * next distinct rating skips ahead. Expects ratings sorted high to low.
 */
export function competitionRanks(ratings: readonly (number | null)[]): number[] {
  const ranks: number[] = [];
  ratings.forEach((rating, i) => {
    ranks.push(i > 0 && rating === ratings[i - 1] ? ranks[i - 1] : i + 1);
  });
  return ranks;
}
