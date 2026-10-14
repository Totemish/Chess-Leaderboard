export type RatingFormat = 'rapid' | 'blitz' | 'bullet';

export interface ChessProfile {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  country: string | null;
  title: string | null;
  rapidRating: number | null;
  blitzRating: number | null;
  bulletRating: number | null;
  user?: {
    name: string | null;
  } | null;
  lastUpdated: string;
}

export interface RatingHistory {
  id: string;
  profileId: string;
  format: string;
  rating: number;
  date: string;
}

export interface PlayerDetails extends ChessProfile {
  ratingHistories: RatingHistory[];
}

/** Every Express endpoint answers with this envelope. */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface LeaderboardResponse extends ApiResponse<ChessProfile[]> {
  nextCursor: string | null;
}

export type Role = 'USER' | 'ADMIN';

export interface User {
  id: string;
  authId: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: Role;
  chessProfileId: string | null;
  chessProfile?: PlayerDetails | null;
}

export type TournamentStatus = 'PENDING' | 'ONGOING' | 'COMPLETED';
export type MatchStatus = 'PENDING' | 'COMPLETED';

export interface TournamentSummary {
  id: string;
  name: string;
  status: TournamentStatus;
  /** Time control used for seeding. */
  format: RatingFormat;
  /** Last round paired; 0 before round 1. */
  currentRound: number;
  createdAt: string;
  updatedAt: string;
  _count?: { participants: number };
}

export interface Participant {
  id: string;
  tournamentId: string;
  profileId: string;
  score: number;
  buchholz: number;
  seedRating: number;
  profile: ChessProfile;
}

/** player1 plays White and player2 Black; a bye has no player2. */
export interface Match {
  id: string;
  tournamentId: string;
  round: number;
  player1Id: string | null;
  player2Id: string | null;
  winnerId: string | null;
  isDraw: boolean;
  status: MatchStatus;
  player1: ChessProfile | null;
  player2: ChessProfile | null;
}

export interface TournamentDetails extends TournamentSummary {
  participants: Participant[];
  matches: Match[];
}
