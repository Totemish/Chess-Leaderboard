import { maxWeightMatching, type WeightedEdge } from '../matching/blossom';
import { allocateColours, colourPreference, STRENGTH_ORDER, type ColourPreference } from './colours';
import type { Colour, Pairing, PairingPlayer, PairingStrategy, PastGame } from './types';

/** The Dutch-system ordering term is capped so it never needs a large tier. */
const RANK_CAP = 31;

/** Keeps every weight, and the algorithm's dual arithmetic, exact in a double. */
const MAX_SAFE_COST = 2 ** 50;

export interface CostTiers {
  mildColour: number;
  strongColour: number;
  scoreGap: number;
  absoluteColour: number;
  repeat: number;
}

/**
 * Unit costs for each pairing rule, from least to most important. Each unit is
 * larger than the worst possible total of every lower tier across all boards,
 * so minimising the sum minimises the rules lexicographically: one rematch is
 * worse than any number of absolute colour clashes, one clash is worse than any
 * score gaps, and so on. `maxSpread` is the largest score difference in points.
 */
export function costTiers(pairs: number, maxSpread: number): CostTiers {
  const mildColour = pairs * RANK_CAP + 1;
  const strongColour = pairs * (RANK_CAP + mildColour) + 1;
  const scoreGap = pairs * (RANK_CAP + strongColour) + 1;
  const maxGap = (2 * maxSpread) ** 2 * scoreGap;
  const absoluteColour = pairs * (RANK_CAP + strongColour + maxGap) + 1;
  const repeat = pairs * (RANK_CAP + absoluteColour + maxGap) + 1;
  return { mildColour, strongColour, scoreGap, absoluteColour, repeat };
}

interface Ranked {
  id: string;
  score: number;
  index: number;
  groupPosition: number;
  groupSize: number;
  history: Colour[];
  preference: ColourPreference;
  hadBye: boolean;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Swiss pairing as a minimum-cost perfect matching.
 *
 * Every possible board (player against player, or player against the bye when
 * the count is odd) gets a cost from the tiers above. Edmonds' blossom
 * algorithm then finds the perfect matching with the lowest total, so the
 * result is optimal for the whole round rather than greedy board by board.
 *
 * Rematches and second byes are very expensive rather than forbidden. A round
 * can therefore always be paired, and a rematch only happens when no pairing
 * without one exists.
 */
export class SwissPairing implements PairingStrategy {
  readonly name = 'swiss';

  pairRound(players: readonly PairingPlayer[], history: readonly PastGame[]): Pairing[] {
    if (players.length < 2) throw new RangeError('At least two players are needed to pair a round');
    if (new Set(players.map((p) => p.id)).size !== players.length) throw new RangeError('Player ids must be unique');

    const ranked = this.rank(players, history);
    const played = new Set(history.filter((g) => g.blackId !== null).map((g) => pairKey(g.whiteId, g.blackId!)));
    const n = ranked.length;
    const bye = n % 2 === 1 ? n : -1; // an extra vertex stands in for the bye
    const scores = ranked.map((p) => p.score);
    const minScore = Math.min(...scores);
    // The bye's score gap is measured from one point below the lowest score (see byeCost).
    const tiers = costTiers(Math.ceil(n / 2), Math.max(...scores) - minScore + (bye === -1 ? 0 : 1));

    const costs: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        costs.push([i, j, this.boardCost(ranked[i]!, ranked[j]!, played, tiers)]);
      }
      if (bye !== -1) costs.push([i, bye, this.byeCost(ranked[i]!, n, minScore, tiers)]);
    }

    // Maximise (base - cost) over perfect matchings = minimise total cost.
    const maxCost = costs.reduce((max, [, , c]) => Math.max(max, c), 0);
    if (maxCost > MAX_SAFE_COST) throw new RangeError('Too many players for exact pairing weights');
    const edges: WeightedEdge[] = costs.map(([i, j, c]) => [i, j, maxCost + 1 - c]);
    const mate = maxWeightMatching(edges, true);

    const boards: { a: Ranked; b: Ranked | null }[] = [];
    for (let i = 0; i < n; i++) {
      const j = mate[i]!;
      if (j === bye) boards.push({ a: ranked[i]!, b: null });
      else if (j > i) boards.push({ a: ranked[i]!, b: ranked[j]! }); // a is the higher-ranked
    }

    // Publish boards by score group: leaders first, the bye last.
    boards.sort((x, y) => {
      if ((x.b === null) !== (y.b === null)) return x.b === null ? 1 : -1;
      const top = (bd: typeof x) => Math.max(bd.a.score, bd.b?.score ?? -Infinity);
      const sum = (bd: typeof x) => bd.a.score + (bd.b?.score ?? 0);
      return top(y) - top(x) || sum(y) - sum(x) || x.a.index - y.a.index;
    });

    return boards.map(({ a, b }, board) => {
      if (b === null) return { whiteId: a.id, blackId: null };
      const { aColour } = allocateColours(a, b, board);
      return aColour === 'white' ? { whiteId: a.id, blackId: b.id } : { whiteId: b.id, blackId: a.id };
    });
  }

  /** Ranks by score, then rating, and records colour history and score-group positions. */
  private rank(players: readonly PairingPlayer[], history: readonly PastGame[]): Ranked[] {
    const colours = new Map<string, Colour[]>();
    const byes = new Set<string>();
    for (const game of [...history].sort((x, y) => x.round - y.round)) {
      if (game.blackId === null) {
        byes.add(game.whiteId);
        continue;
      }
      colours.set(game.whiteId, [...(colours.get(game.whiteId) ?? []), 'white']);
      colours.set(game.blackId, [...(colours.get(game.blackId) ?? []), 'black']);
    }

    const sorted = [...players].sort((a, b) => b.score - a.score || b.rating - a.rating || a.id.localeCompare(b.id));
    const groupSizes = new Map<number, number>();
    for (const p of sorted) groupSizes.set(p.score, (groupSizes.get(p.score) ?? 0) + 1);
    const seen = new Map<number, number>();

    return sorted.map((p, index) => {
      const groupPosition = seen.get(p.score) ?? 0;
      seen.set(p.score, groupPosition + 1);
      const playerHistory = colours.get(p.id) ?? [];
      return {
        id: p.id,
        score: p.score,
        index,
        groupPosition,
        groupSize: groupSizes.get(p.score)!,
        history: playerHistory,
        preference: colourPreference(playerHistory),
        hadBye: byes.has(p.id),
      };
    });
  }

  private boardCost(a: Ranked, b: Ranked, played: Set<string>, tiers: CostTiers): number {
    let cost = 0;
    if (played.has(pairKey(a.id, b.id))) cost += tiers.repeat;

    // Same colour wanted by both: the weaker preference will be overruled.
    if (a.preference.colour !== null && a.preference.colour === b.preference.colour) {
      const weaker = Math.min(STRENGTH_ORDER[a.preference.strength], STRENGTH_ORDER[b.preference.strength]);
      cost += [0, tiers.mildColour, tiers.strongColour, tiers.absoluteColour][weaker]!;
    }

    // Squared, so two small floats are preferred to one large one.
    cost += (2 * Math.abs(a.score - b.score)) ** 2 * tiers.scoreGap;

    // Dutch system: within a score group, the top half meets the bottom half
    // (1st vs (g/2+1)th, ...). Across groups, prefer neighbouring ranks.
    if (a.score === b.score) {
      const ideal = Math.floor(a.groupSize / 2);
      cost += Math.min(RANK_CAP, Math.abs(Math.abs(b.groupPosition - a.groupPosition) - ideal));
    } else {
      cost += Math.min(RANK_CAP, Math.abs(b.index - a.index) - 1);
    }
    return cost;
  }

  /**
   * The bye goes to the lowest-ranked player in the lowest score group who
   * hasn't had one. As in the FIDE Dutch rules, its score gap is measured
   * against a virtual opponent one point below the lowest score, so a bye for
   * a higher score always costs more than floating other players instead.
   */
  private byeCost(p: Ranked, n: number, minScore: number, tiers: CostTiers): number {
    return (
      (p.hadBye ? tiers.repeat : 0) +
      (2 * (p.score - minScore + 1)) ** 2 * tiers.scoreGap +
      Math.min(RANK_CAP, n - 1 - p.index)
    );
  }
}
