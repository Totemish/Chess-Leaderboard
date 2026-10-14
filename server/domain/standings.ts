/** A game as the standings see it. `blackId` is null for a bye. */
export interface GameRecord {
  whiteId: string | null;
  blackId: string | null;
  winnerId: string | null;
  isDraw: boolean;
  completed: boolean;
}

export interface Standing {
  score: number;
  /** Sum of the final scores of everyone the player has faced. */
  buchholz: number;
}

/**
 * Recomputes every score and Buchholz tie-break from the games themselves.
 * Deriving them on each change, rather than incrementing stored totals, means a
 * retried or concurrent request can never count a result twice.
 *
 * A bye scores 1 point. For Buchholz it counts as a game against a virtual
 * opponent with the player's own score, the usual convention for unplayed
 * rounds, so a bye neither helps nor hurts the tie-break.
 */
export function computeStandings(playerIds: readonly string[], games: readonly GameRecord[]): Map<string, Standing> {
  const finished = games.filter((g) => g.completed && g.whiteId !== null);
  const score = new Map(playerIds.map((id) => [id, 0]));
  const add = (id: string | null, points: number) => {
    if (id !== null && score.has(id)) score.set(id, score.get(id)! + points);
  };

  for (const g of finished) {
    if (g.blackId === null) add(g.whiteId, 1);
    else if (g.isDraw) {
      add(g.whiteId, 0.5);
      add(g.blackId, 0.5);
    } else add(g.winnerId, 1);
  }

  const buchholz = new Map(playerIds.map((id) => [id, 0]));
  for (const g of finished) {
    const white = g.whiteId!;
    if (g.blackId === null) {
      if (buchholz.has(white)) buchholz.set(white, buchholz.get(white)! + score.get(white)!);
      continue;
    }
    if (buchholz.has(white)) buchholz.set(white, buchholz.get(white)! + (score.get(g.blackId) ?? 0));
    if (buchholz.has(g.blackId)) buchholz.set(g.blackId, buchholz.get(g.blackId)! + (score.get(white) ?? 0));
  }

  return new Map(playerIds.map((id) => [id, { score: score.get(id)!, buchholz: buchholz.get(id)! }]));
}
