import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SwissPairing } from '../domain/pairing/swiss';
import { colourPreference } from '../domain/pairing/colours';
import type { Colour, Pairing, PairingPlayer, PastGame } from '../domain/pairing/types';
import { seededRandom } from './helpers';

const engine = new SwissPairing();

interface SimPlayer extends PairingPlayer {
  strength: number;
}

function coloursOf(id: string, history: readonly PastGame[]): Colour[] {
  return [...history]
    .sort((a, b) => a.round - b.round)
    .flatMap((g): Colour[] => (g.blackId === null ? [] : g.whiteId === id ? ['white'] : g.blackId === id ? ['black'] : []));
}

/** The three top-priority quantities the engine must minimise, in priority order. */
function priorities(pairings: readonly Pairing[], players: readonly PairingPlayer[], history: readonly PastGame[]) {
  const score = new Map(players.map((p) => [p.id, p.score]));
  const minScore = Math.min(...players.map((p) => p.score));
  const played = new Set(history.filter((g) => g.blackId).map((g) => [g.whiteId, g.blackId].sort().join('|')));
  const hadBye = new Set(history.filter((g) => g.blackId === null).map((g) => g.whiteId));
  let repeats = 0;
  let clashes = 0;
  let gap = 0;
  for (const { whiteId, blackId } of pairings) {
    if (blackId === null) {
      if (hadBye.has(whiteId)) repeats++;
      // FIDE: the bye's score difference is taken against one point below the lowest score.
      gap += (2 * (score.get(whiteId)! - minScore + 1)) ** 2;
      continue;
    }
    if (played.has([whiteId, blackId].sort().join('|'))) repeats++;
    const pa = colourPreference(coloursOf(whiteId, history));
    const pb = colourPreference(coloursOf(blackId, history));
    if (pa.strength === 'absolute' && pb.strength === 'absolute' && pa.colour === pb.colour) clashes++;
    gap += (2 * Math.abs(score.get(whiteId)! - score.get(blackId)!)) ** 2;
  }
  return [repeats, clashes, gap] as const;
}

/** Exact lexicographic optimum of those quantities by DP over subsets (n ≤ ~16). */
function optimalPriorities(players: readonly PairingPlayer[], history: readonly PastGame[]) {
  const n = players.length;
  const v = n % 2 === 1 ? n + 1 : n; // vertex n is the bye
  const minScore = Math.min(...players.map((p) => p.score));
  const played = new Set(history.filter((g) => g.blackId).map((g) => [g.whiteId, g.blackId].sort().join('|')));
  const hadBye = new Set(history.filter((g) => g.blackId === null).map((g) => g.whiteId));
  const prefs = players.map((p) => colourPreference(coloursOf(p.id, history)));
  const cost = (i: number, j: number): [number, number, number] => {
    if (j === n) return [hadBye.has(players[i]!.id) ? 1 : 0, 0, (2 * (players[i]!.score - minScore + 1)) ** 2];
    const a = players[i]!;
    const b = players[j]!;
    const clash = prefs[i]!.strength === 'absolute' && prefs[j]!.strength === 'absolute' && prefs[i]!.colour === prefs[j]!.colour;
    return [played.has([a.id, b.id].sort().join('|')) ? 1 : 0, clash ? 1 : 0, (2 * Math.abs(a.score - b.score)) ** 2];
  };
  const less = (x: readonly number[], y: readonly number[]) => x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
  const memo = new Map<number, [number, number, number]>();
  const solve = (mask: number): [number, number, number] => {
    if (mask === 0) return [0, 0, 0];
    const hit = memo.get(mask);
    if (hit) return hit;
    let i = 0;
    while (!(mask & (1 << i))) i++;
    let best: [number, number, number] = [Infinity, Infinity, Infinity];
    for (let j = i + 1; j < v; j++) {
      if (!(mask & (1 << j))) continue;
      const sub = solve(mask & ~(1 << i) & ~(1 << j));
      const c = cost(i, j);
      const total: [number, number, number] = [sub[0] + c[0], sub[1] + c[1], sub[2] + c[2]];
      if (less(total, best) < 0) best = total;
    }
    memo.set(mask, best);
    return best;
  };
  return solve((1 << v) - 1);
}

/** Plays a whole event with random results weighted by strength. */
function simulate(n: number, rounds: number, seed: number, onRound?: (players: PairingPlayer[], history: PastGame[], pairings: Pairing[]) => void) {
  const random = seededRandom(seed);
  const players: SimPlayer[] = Array.from({ length: n }, (_, i) => ({
    id: `p${String(i).padStart(2, '0')}`,
    score: 0,
    rating: 2200 - i * 25,
    strength: 2200 - i * 25 + random() * 200,
  }));
  const history: PastGame[] = [];
  for (let round = 1; round <= rounds; round++) {
    const snapshot = players.map(({ id, score, rating }) => ({ id, score, rating }));
    const pairings = engine.pairRound(snapshot, history);
    onRound?.(snapshot, [...history], pairings);
    for (const { whiteId, blackId } of pairings) {
      history.push({ round, whiteId, blackId });
      const white = players.find((p) => p.id === whiteId)!;
      if (blackId === null) {
        white.score += 1;
        continue;
      }
      const black = players.find((p) => p.id === blackId)!;
      const expected = 1 / (1 + 10 ** ((black.strength - white.strength) / 400));
      const x = random();
      if (x < expected - 0.1) white.score += 1;
      else if (x < expected + 0.1) {
        white.score += 0.5;
        black.score += 0.5;
      } else black.score += 1;
    }
  }
  return { players, history };
}

test('round 1 pairs the top half against the bottom half and alternates colours', () => {
  const players = Array.from({ length: 8 }, (_, i) => ({ id: `s${i + 1}`, score: 0, rating: 2000 - i * 50 }));
  assert.deepEqual(engine.pairRound(players, []), [
    { whiteId: 's1', blackId: 's5' },
    { whiteId: 's6', blackId: 's2' },
    { whiteId: 's3', blackId: 's7' },
    { whiteId: 's8', blackId: 's4' },
  ]);
});

test('an odd field gives the bye to the lowest-ranked player', () => {
  const players = Array.from({ length: 5 }, (_, i) => ({ id: `s${i + 1}`, score: 0, rating: 2000 - i * 50 }));
  const pairings = engine.pairRound(players, []);
  assert.deepEqual(pairings[pairings.length - 1], { whiteId: 's5', blackId: null });
});

test('the bye goes to the lowest score, even if that means two half-point floats', () => {
  // Round 1: anna lost to chen, dev drew ben, esha had the bye. Ben and dev can't meet again,
  // so someone floats either way. FIDE wants the bye on the lowest score: anna's 0, not dev's ½.
  const players = [
    { id: 'anna', score: 0, rating: 1910 },
    { id: 'ben', score: 0.5, rating: 1840 },
    { id: 'chen', score: 1, rating: 1775 },
    { id: 'dev', score: 0.5, rating: 1702 },
    { id: 'esha', score: 1, rating: 1650 },
  ];
  const history = [
    { round: 1, whiteId: 'anna', blackId: 'chen' },
    { round: 1, whiteId: 'dev', blackId: 'ben' },
    { round: 1, whiteId: 'esha', blackId: null },
  ];
  const pairings = engine.pairRound(players, history);
  assert.deepEqual(pairings.find((p) => p.blackId === null), { whiteId: 'anna', blackId: null });
});

test('every player is paired exactly once, every round, even in long events', () => {
  for (const [n, rounds] of [[8, 7], [9, 9], [10, 12], [6, 8], [16, 9], [33, 11]] as const) {
    for (let seed = 1; seed <= 10; seed++) {
      simulate(n, rounds, seed * 97 + n, (players, _history, pairings) => {
        const seen = pairings.flatMap((p) => (p.blackId ? [p.whiteId, p.blackId] : [p.whiteId]));
        assert.equal(seen.length, players.length, `n=${n}`);
        assert.equal(new Set(seen).size, players.length, `n=${n}: someone was paired twice`);
        assert.equal(pairings.filter((p) => p.blackId === null).length, n % 2, `n=${n}: wrong number of byes`);
      });
    }
  }
});

test('optimal on rematches, colour clashes and score gaps (vs exact DP), 2,000+ rounds', () => {
  let rounds = 0;
  for (const n of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
    for (let seed = 1; seed <= 30; seed++) {
      simulate(n, Math.min(n - 1, 9), seed * 31 + n, (players, history, pairings) => {
        rounds++;
        assert.deepEqual(priorities(pairings, players, history), optimalPriorities(players, history), `n=${n} seed=${seed} round=${history.length / Math.ceil(n / 2) + 1}`);
      });
    }
  }
  assert.ok(rounds > 2000);
});

// In very long events (say 7 rounds for 10 players) a colour clash can be forced
// to avoid a rematch; the DP test above proves the engine then uses the fewest.
test('colour balance stays within FIDE limits at typical Swiss lengths', () => {
  let violations = 0;
  for (const [n, rounds] of [[10, 5], [12, 6], [16, 7], [20, 7], [25, 7], [32, 8]] as const) {
    for (let seed = 1; seed <= 20; seed++) {
      const { players, history } = simulate(n, rounds, seed * 13 + n);
      for (const p of players) {
        const c = coloursOf(p.id, history);
        const diff = c.filter((x) => x === 'white').length - c.filter((x) => x === 'black').length;
        const threeInARow = c.some((x, i) => i >= 2 && x === c[i - 1] && x === c[i - 2]);
        if (Math.abs(diff) > 2 || threeInARow) violations++;
      }
    }
  }
  assert.equal(violations, 0);
});

test('rejects bad input', () => {
  assert.throws(() => engine.pairRound([{ id: 'a', score: 0, rating: 1 }], []), RangeError);
  assert.throws(
    () => engine.pairRound([{ id: 'a', score: 0, rating: 1 }, { id: 'a', score: 0, rating: 2 }], []),
    RangeError
  );
});
