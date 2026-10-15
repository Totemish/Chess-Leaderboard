export type RatingFormat = 'rapid' | 'blitz' | 'bullet';

/** Only ACTIVE players are on the leaderboard; the others keep their history and results. */
export type PlayerStatus = 'ACTIVE' | 'CLOSED' | 'CLOSED_FAIR_PLAY' | 'MISSING' | 'REMOVED';

export interface ChessProfile {
  id: string;
  username: string;
  /** Missing from APIs older than this field; treat that as ACTIVE. */
  status?: PlayerStatus;
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

/** One way the member signs in (a Google, GitHub or Discord account). */
export interface Identity {
  provider: string;
  email: string | null;
  createdAt: string;
}

/** A member: one person, however many ways they sign in. */
export interface User {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  /**
   * The verified institute address that lets the member join the leaderboard.
   * This and `identities` are missing from APIs older than member identities.
   */
  instituteEmail?: string | null;
  role: Role;
  chessProfileId: string | null;
  chessProfile?: PlayerDetails | null;
  identities?: Identity[];
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
