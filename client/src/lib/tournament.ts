import type { Match, Participant, TournamentStatus } from '@/types';

export type GameOutcome = 'win' | 'draw' | 'loss' | 'bye' | 'pending';

export interface CrosstableCell {
  round: number;
  outcome: GameOutcome;
  /** The opponent's current place in the standings; null for a bye. */
  opponentPlace: number | null;
}

export interface CrosstableRow {
  place: number;
  participant: Participant;
  /** One entry per round, in order; null when the player was not paired that round. */
  cells: (CrosstableCell | null)[];
}

export function isBye(match: Match): boolean {
  return match.player2Id === null;
}

export function roundsOf(matches: Match[]): number[] {
  return [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
}

export function outcomeFor(match: Match, profileId: string): GameOutcome {
  if (isBye(match)) return 'bye';
  if (match.status !== 'COMPLETED') return 'pending';
  if (match.isDraw) return 'draw';
  return match.winnerId === profileId ? 'win' : 'loss';
}

function pointsFor(match: Match, profileId: string): number {
  const outcome = outcomeFor(match, profileId);
  if (outcome === 'win' || outcome === 'bye') return 1;
  return outcome === 'draw' ? 0.5 : 0;
}

/** Each player's game in each round, keyed `round:profileId`, for O(1) lookups. */
function indexGames(matches: Match[]): Map<string, Match> {
  const index = new Map<string, Match>();
  for (const m of matches) {
    if (m.player1Id) index.set(`${m.round}:${m.player1Id}`, m);
    if (m.player2Id) index.set(`${m.round}:${m.player2Id}`, m);
  }
  return index;
}

/**
 * Pivots matches into a crosstable: one row per player in standings order, one
 * cell per round naming the opponent by their place. O(players × rounds).
 */
export function buildCrosstable(participants: Participant[], matches: Match[]) {
  const rounds = roundsOf(matches);
  const games = indexGames(matches);
  const placeOf = new Map(participants.map((p, i) => [p.profileId, i + 1]));

  const rows: CrosstableRow[] = participants.map((participant, i) => ({
    place: i + 1,
    participant,
    cells: rounds.map((round) => {
      const match = games.get(`${round}:${participant.profileId}`);
      if (!match) return null;
      const opponentId = match.player1Id === participant.profileId ? match.player2Id : match.player1Id;
      return {
        round,
        outcome: outcomeFor(match, participant.profileId),
        opponentPlace: opponentId ? (placeOf.get(opponentId) ?? null) : null,
      };
    }),
  }));

  return { rounds, rows };
}

/** Points each player had before `round` started, rebuilt from earlier results. */
export function scoresBeforeRound(matches: Match[], round: number): Map<string, number> {
  const scores = new Map<string, number>();
  for (const m of matches) {
    if (m.round >= round) continue;
    for (const id of [m.player1Id, m.player2Id]) {
      if (id) scores.set(id, (scores.get(id) ?? 0) + pointsFor(m, id));
    }
  }
  return scores;
}

/**
 * Orders one round's games into boards the way Swiss pairings are published:
 * leading score groups first (higher score, then combined score), then rating.
 * Uses scores from before the round, so entering results never reshuffles boards.
 */
export function boardOrder(roundMatches: Match[], allMatches: Match[], seedOf: Map<string, number>): Match[] {
  const round = roundMatches[0]?.round ?? 1;
  const before = scoresBeforeRound(allMatches, round);
  const key = (m: Match) => {
    const ids = [m.player1Id, m.player2Id].filter((id): id is string => id !== null);
    const scores = ids.map((id) => before.get(id) ?? 0);
    return {
      bye: isBye(m),
      top: Math.max(...scores),
      sum: scores.reduce((a, b) => a + b, 0),
      seed: Math.max(...ids.map((id) => seedOf.get(id) ?? 0)),
    };
  };

  return [...roundMatches].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka.bye !== kb.bye) return ka.bye ? 1 : -1;
    return kb.top - ka.top || kb.sum - ka.sum || kb.seed - ka.seed || a.id.localeCompare(b.id);
  });
}

/** Result in score-sheet notation, or null while the game is unplayed. */
export function resultNotation(match: Match): string | null {
  if (isBye(match)) return 'bye';
  if (match.status !== 'COMPLETED') return null;
  if (match.isDraw) return '½–½';
  return match.winnerId === match.player1Id ? '1–0' : '0–1';
}

export function statusText(status: TournamentStatus, latestRound: number): string {
  if (status === 'PENDING') return 'Registration open';
  if (status === 'ONGOING') return latestRound > 0 ? `Round ${latestRound} in progress` : 'In progress';
  return 'Finished';
}
