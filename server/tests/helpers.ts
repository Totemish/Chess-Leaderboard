import type { WeightedEdge } from '../domain/matching/blossom';

/** Deterministic pseudo-random numbers (LCG) so failures are reproducible. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * Exact optimum by dynamic programming over vertex subsets, O(2^n · n).
 * Returns the best (cardinality, weight) pair, ordered by weight alone, or
 * by cardinality first when `maxCardinality` is set.
 */
export function bruteForceMatching(
  nVertex: number,
  edges: readonly WeightedEdge[],
  maxCardinality: boolean
): { cardinality: number; weight: number } {
  const weight = new Map<string, number>();
  for (const [i, j, w] of edges) {
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    weight.set(key, Math.max(weight.get(key) ?? -Infinity, w));
  }
  const better = (a: { cardinality: number; weight: number }, b: { cardinality: number; weight: number }) =>
    maxCardinality ? a.cardinality > b.cardinality || (a.cardinality === b.cardinality && a.weight > b.weight) : a.weight > b.weight;

  const memo = new Map<number, { cardinality: number; weight: number }>();
  const solve = (mask: number): { cardinality: number; weight: number } => {
    if (mask === 0) return { cardinality: 0, weight: 0 };
    const cached = memo.get(mask);
    if (cached) return cached;
    let i = 0;
    while (!(mask & (1 << i))) i++;
    const rest = mask & ~(1 << i);
    let best = solve(rest); // leave i single
    for (let j = i + 1; j < nVertex; j++) {
      if (!(rest & (1 << j))) continue;
      const w = weight.get(`${i},${j}`);
      if (w === undefined) continue;
      const sub = solve(rest & ~(1 << j));
      const candidate = { cardinality: sub.cardinality + 1, weight: sub.weight + w };
      if (better(candidate, best)) best = candidate;
    }
    memo.set(mask, best);
    return best;
  };
  return solve((1 << nVertex) - 1);
}

/** Checks that `mate` is a valid matching over `edges` and returns its size and weight. */
export function measureMatching(
  mate: readonly number[],
  edges: readonly WeightedEdge[]
): { cardinality: number; weight: number } {
  const weight = new Map<string, number>();
  for (const [i, j, w] of edges) {
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    weight.set(key, Math.max(weight.get(key) ?? -Infinity, w));
  }
  let cardinality = 0;
  let total = 0;
  mate.forEach((m, v) => {
    if (m === -1) return;
    if (mate[m] !== v) throw new Error(`mate is not symmetric at ${v}`);
    if (v < m) {
      const w = weight.get(`${v},${m}`);
      if (w === undefined) throw new Error(`matched pair (${v}, ${m}) is not an edge`);
      cardinality++;
      total += w;
    }
  });
  return { cardinality, weight: total };
}
