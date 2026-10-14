import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maxWeightMatching, type WeightedEdge } from '../domain/matching/blossom';
import { bruteForceMatching, measureMatching, seededRandom } from './helpers';

test('trivial graphs', () => {
  assert.deepEqual(maxWeightMatching([]), []);
  assert.deepEqual(maxWeightMatching([[0, 1, 1]]), [1, 0]);
  assert.deepEqual(maxWeightMatching([[1, 2, 10], [2, 3, 11]]), [-1, -1, 3, 2]);
});

test('max weight versus max cardinality', () => {
  const edges: WeightedEdge[] = [[1, 2, 5], [2, 3, 11], [3, 4, 5]];
  // One heavy edge beats two light ones...
  assert.deepEqual(maxWeightMatching(edges), [-1, -1, 3, 2, -1]);
  // ...unless more pairs are required.
  assert.deepEqual(maxWeightMatching(edges, true), [-1, 2, 1, 4, 3]);
});

test('negative weights are left out unless cardinality demands them', () => {
  const edges: WeightedEdge[] = [[1, 2, 2], [1, 3, -2], [2, 3, 1], [2, 4, -1], [3, 4, -6]];
  assert.deepEqual(maxWeightMatching(edges), [-1, 2, 1, -1, -1]);
  assert.deepEqual(maxWeightMatching(edges, true), [-1, 3, 4, 1, 2]);
});

test('creates an S-blossom and augments through it', () => {
  assert.deepEqual(maxWeightMatching([[1, 2, 8], [1, 3, 9], [2, 3, 10], [3, 4, 7]]), [-1, 2, 1, 4, 3]);
  assert.deepEqual(
    maxWeightMatching([[1, 2, 8], [1, 3, 9], [2, 3, 10], [3, 4, 7], [1, 6, 5], [4, 5, 6]]),
    [-1, 6, 3, 2, 5, 4, 1]
  );
});

test('expands nested blossoms (T-blossom relabelling)', () => {
  const edges: WeightedEdge[] = [
    [1, 2, 45], [1, 5, 45], [2, 3, 50], [3, 4, 45], [4, 5, 50],
    [1, 6, 30], [3, 9, 35], [4, 8, 35], [5, 7, 26], [9, 10, 5],
  ];
  assert.deepEqual(maxWeightMatching(edges), [-1, 6, 3, 2, 8, 7, 1, 5, 4, 10, 9]);
});

test('matches the brute-force optimum on 3,000 random graphs', () => {
  const random = seededRandom(20261014);
  for (let trial = 0; trial < 3000; trial++) {
    const n = 2 + Math.floor(random() * 11); // 2..12 vertices
    const density = 0.2 + random() * 0.8;
    const edges: WeightedEdge[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (random() < density) edges.push([i, j, Math.floor(random() * 41) - 10]); // weights -10..30
      }
    }
    if (edges.length === 0) continue;
    for (const maxCardinality of [false, true]) {
      const mate = maxWeightMatching(edges, maxCardinality);
      const got = measureMatching(mate, edges);
      const want = bruteForceMatching(n, edges, maxCardinality);
      const label = `trial ${trial}, n=${n}, maxCardinality=${maxCardinality}, edges=${JSON.stringify(edges)}`;
      if (maxCardinality) assert.equal(got.cardinality, want.cardinality, label);
      assert.equal(got.weight, want.weight, label);
    }
  }
});

test('rejects non-integer weights', () => {
  assert.throws(() => maxWeightMatching([[0, 1, 1.5]]), RangeError);
  assert.throws(() => maxWeightMatching([[0, 0, 1]]), RangeError);
});
