/**
 * Maximum-weight matching in a general graph: Edmonds' blossom algorithm with
 * the primal-dual method, O(n³).
 *
 * Why not the Hungarian algorithm? It only works on bipartite graphs. In Swiss
 * pairing anyone can be paired with anyone, so the graph has odd cycles. Edmonds
 * handles an odd cycle by shrinking it into a single "blossom" vertex, searching
 * for augmenting paths in the shrunken graph, and expanding blossoms afterwards.
 *
 * The search keeps a dual variable per vertex and per blossom. An edge is
 * "tight" (usable) when its slack (u_i + u_j - 2w_ij, duals pre-multiplied by 2)
 * is zero. When no augmenting path exists among tight edges, the duals shift by
 * the smallest delta that makes a new edge tight or a blossom expandable. When
 * the loop ends, the matching and duals together prove the matching is optimal.
 *
 * The structure follows Galil, "Efficient Algorithms for Finding Maximum
 * Matching in Graphs" (ACM Computing Surveys, 1986), as organised in Joris van
 * Rantwijk's reference implementation (mwmatching.py).
 *
 * Weights must be safe integers so that every dual update stays exact.
 */

/** An undirected edge between vertices i and j (0-based) with an integer weight. */
export type WeightedEdge = readonly [i: number, j: number, weight: number];

/**
 * Returns `mate`, where mate[v] is the vertex matched to v, or -1 if v is single.
 * With `maxCardinality`, only maximum-cardinality matchings are considered,
 * and the heaviest of those is returned. On a complete graph with an even
 * number of vertices, that means a perfect matching.
 */
export function maxWeightMatching(edges: readonly WeightedEdge[], maxCardinality = false): number[] {
  if (edges.length === 0) return [];

  const nEdge = edges.length;
  let nVertex = 0;
  let maxWeight = 0;
  for (const [i, j, w] of edges) {
    if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0 || i === j) {
      throw new RangeError(`Invalid edge (${i}, ${j})`);
    }
    if (!Number.isSafeInteger(w)) throw new RangeError(`Edge weight ${w} is not a safe integer`);
    nVertex = Math.max(nVertex, i + 1, j + 1);
    maxWeight = Math.max(maxWeight, w);
  }

  // Edge k has two endpoints: 2k (its vertex i) and 2k+1 (its vertex j).
  // endpoint[p] is the vertex at endpoint p, and p ^ 1 is the other end.
  const endpoint: number[] = [];
  for (const [i, j] of edges) endpoint.push(i, j);

  // neighbEnd[v]: the remote endpoints of every edge touching v.
  const neighbEnd: number[][] = Array.from({ length: nVertex }, () => []);
  edges.forEach(([i, j], k) => {
    neighbEnd[i]!.push(2 * k + 1);
    neighbEnd[j]!.push(2 * k);
  });

  // mate[v]: the remote endpoint of v's matched edge, or -1.
  const mate: number[] = new Array(nVertex).fill(-1);

  // Indices 0..n-1 are vertices; n..2n-1 are blossoms.
  // label[b]: 0 = free, 1 = S (outer), 2 = T (inner); 5 marks a breadcrumb in scanBlossom.
  const label: number[] = new Array(2 * nVertex).fill(0);
  // labelEnd[b]: the endpoint through which b got its label, or -1.
  const labelEnd: number[] = new Array(2 * nVertex).fill(-1);
  // inBlossom[v]: the top-level blossom containing vertex v.
  const inBlossom: number[] = Array.from({ length: nVertex }, (_, v) => v);
  const blossomParent: number[] = new Array(2 * nVertex).fill(-1);
  // blossomChilds[b]: sub-blossoms in cycle order, starting with the base.
  const blossomChilds: (number[] | null)[] = new Array(2 * nVertex).fill(null);
  const blossomBase: number[] = Array.from({ length: 2 * nVertex }, (_, b) => (b < nVertex ? b : -1));
  // blossomEndps[b][i]: endpoint on the edge joining blossomChilds[b][i] to the next child.
  const blossomEndps: (number[] | null)[] = new Array(2 * nVertex).fill(null);
  // bestEdge[b]: least-slack edge to a different S-blossom (or, for free vertices, to any S-vertex).
  const bestEdge: number[] = new Array(2 * nVertex).fill(-1);
  const blossomBestEdges: (number[] | null)[] = new Array(2 * nVertex).fill(null);
  const unusedBlossoms: number[] = Array.from({ length: nVertex }, (_, i) => nVertex + i);
  // Vertex duals start at maxWeight; blossom duals at 0.
  const dualVar: number[] = Array.from({ length: 2 * nVertex }, (_, i) => (i < nVertex ? maxWeight : 0));
  const allowEdge: boolean[] = new Array(nEdge).fill(false);
  let queue: number[] = [];

  /** Index with Python-style wrap-around for negative positions. */
  const at = (list: number[], index: number): number => list[index < 0 ? index + list.length : index]!;

  const slack = (k: number): number => {
    const [i, j, w] = edges[k]!;
    return dualVar[i]! + dualVar[j]! - 2 * w;
  };

  const blossomLeaves = (b: number, out: number[] = []): number[] => {
    if (b < nVertex) {
      out.push(b);
    } else {
      for (const child of blossomChilds[b]!) blossomLeaves(child, out);
    }
    return out;
  };

  /** Labels the top-level blossom of w as t (S or T), reached through endpoint p. */
  const assignLabel = (w: number, t: number, p: number): void => {
    const b = inBlossom[w]!;
    label[w] = label[b] = t;
    labelEnd[w] = labelEnd[b] = p;
    bestEdge[w] = bestEdge[b] = -1;
    if (t === 1) {
      // b became an S-blossom: its vertices can now be scanned.
      queue.push(...blossomLeaves(b));
    } else if (t === 2) {
      // b became a T-blossom: its mate becomes an S-blossom.
      const base = blossomBase[b]!;
      assignLabel(endpoint[mate[base]!]!, 1, mate[base]! ^ 1);
    }
  };

  /**
   * Walks back from S-vertices v and w along their alternating trees. Returns
   * the base of the new blossom if the paths meet, or -1 if they reach two
   * different single vertices (an augmenting path).
   */
  const scanBlossom = (vStart: number, wStart: number): number => {
    let v = vStart;
    let w = wStart;
    const path: number[] = [];
    let base = -1;
    while (v !== -1 || w !== -1) {
      let b = inBlossom[v]!;
      if (label[b]! & 4) {
        base = blossomBase[b]!;
        break;
      }
      path.push(b);
      label[b] = 5;
      if (labelEnd[b] === -1) {
        v = -1; // reached a single vertex: this path ends here
      } else {
        v = endpoint[labelEnd[b]!]!;
        b = inBlossom[v]!;
        v = endpoint[labelEnd[b]!]!; // step over the T-blossom
      }
      if (w !== -1) [v, w] = [w, v]; // alternate between the two paths
    }
    for (const b of path) label[b] = 1;
    return base;
  };

  /** Shrinks the odd cycle closed by edge k into a new S-blossom with the given base. */
  const addBlossom = (base: number, k: number): void => {
    let [v, w] = edges[k]!;
    const bb = inBlossom[base]!;
    let bv = inBlossom[v]!;
    let bw = inBlossom[w]!;
    const b = unusedBlossoms.pop()!;
    blossomBase[b] = base;
    blossomParent[b] = -1;
    blossomParent[bb] = b;

    const path: number[] = [];
    const endps: number[] = [];
    while (bv !== bb) {
      blossomParent[bv] = b;
      path.push(bv);
      endps.push(labelEnd[bv]!);
      v = endpoint[labelEnd[bv]!]!;
      bv = inBlossom[v]!;
    }
    path.push(bb);
    path.reverse();
    endps.reverse();
    endps.push(2 * k);
    while (bw !== bb) {
      blossomParent[bw] = b;
      path.push(bw);
      endps.push(labelEnd[bw]! ^ 1);
      w = endpoint[labelEnd[bw]!]!;
      bw = inBlossom[w]!;
    }
    blossomChilds[b] = path;
    blossomEndps[b] = endps;

    label[b] = 1;
    labelEnd[b] = labelEnd[bb]!;
    dualVar[b] = 0;
    for (const leaf of blossomLeaves(b)) {
      // T-vertices pulled into the blossom become S-vertices and need scanning.
      if (label[inBlossom[leaf]!] === 2) queue.push(leaf);
      inBlossom[leaf] = b;
    }

    // The new blossom's least-slack edges towards every other S-blossom.
    const bestEdgeTo: number[] = new Array(2 * nVertex).fill(-1);
    for (const sub of path) {
      const lists =
        blossomBestEdges[sub] === null
          ? blossomLeaves(sub).map((leaf) => neighbEnd[leaf]!.map((p) => p >> 1))
          : [blossomBestEdges[sub]!];
      for (const list of lists) {
        for (const kk of list) {
          let [i, j] = edges[kk]!;
          if (inBlossom[j] === b) [i, j] = [j, i];
          const bj = inBlossom[j]!;
          if (bj !== b && label[bj] === 1 && (bestEdgeTo[bj] === -1 || slack(kk) < slack(bestEdgeTo[bj]!))) {
            bestEdgeTo[bj] = kk;
          }
        }
      }
      blossomBestEdges[sub] = null;
      bestEdge[sub] = -1;
    }
    const best = bestEdgeTo.filter((kk) => kk !== -1);
    blossomBestEdges[b] = best;
    bestEdge[b] = -1;
    for (const kk of best) {
      if (bestEdge[b] === -1 || slack(kk) < slack(bestEdge[b]!)) bestEdge[b] = kk;
    }
  };

  /** Dissolves blossom b back into its sub-blossoms, relabelling them if it was a T-blossom. */
  const expandBlossom = (b: number, endStage: boolean): void => {
    for (const s of blossomChilds[b]!) {
      blossomParent[s] = -1;
      if (s < nVertex) {
        inBlossom[s] = s;
      } else if (endStage && dualVar[s] === 0) {
        expandBlossom(s, endStage);
      } else {
        for (const leaf of blossomLeaves(s)) inBlossom[leaf] = s;
      }
    }

    if (!endStage && label[b] === 2) {
      // Relabel the even-length path through the expanded T-blossom.
      const childs = blossomChilds[b]!;
      const endps = blossomEndps[b]!;
      const entryChild = inBlossom[endpoint[labelEnd[b]! ^ 1]!]!;
      let j = childs.indexOf(entryChild);
      let jStep: number;
      let endpTrick: number;
      if (j & 1) {
        j -= childs.length; // odd start: go forward and wrap
        jStep = 1;
        endpTrick = 0;
      } else {
        jStep = -1; // even start: go backward
        endpTrick = 1;
      }
      let p = labelEnd[b]!;
      while (j !== 0) {
        label[endpoint[p ^ 1]!] = 0;
        label[endpoint[at(endps, j - endpTrick) ^ endpTrick ^ 1]!] = 0;
        assignLabel(endpoint[p ^ 1]!, 2, p);
        allowEdge[at(endps, j - endpTrick) >> 1] = true;
        j += jStep;
        p = at(endps, j - endpTrick) ^ endpTrick;
        allowEdge[p >> 1] = true;
        j += jStep;
      }
      // The base sub-blossom gets label T without stepping through to its mate.
      const baseChild = at(childs, j);
      label[endpoint[p ^ 1]!] = label[baseChild] = 2;
      labelEnd[endpoint[p ^ 1]!] = labelEnd[baseChild] = p;
      bestEdge[baseChild] = -1;
      j += jStep;
      // Sub-blossoms on the other side may still be reachable from outside.
      while (at(childs, j) !== entryChild) {
        const child = at(childs, j);
        if (label[child] === 1) {
          j += jStep;
          continue;
        }
        const reached = blossomLeaves(child).find((leaf) => label[leaf] !== 0);
        if (reached !== undefined) {
          label[reached] = 0;
          label[endpoint[mate[blossomBase[child]!]!]!] = 0;
          assignLabel(reached, 2, labelEnd[reached]!);
        }
        j += jStep;
      }
    }

    label[b] = labelEnd[b] = -1;
    blossomChilds[b] = blossomEndps[b] = null;
    blossomBase[b] = -1;
    blossomBestEdges[b] = null;
    bestEdge[b] = -1;
    unusedBlossoms.push(b);
  };

  /** Swaps matched and unmatched edges inside blossom b so that vertex v becomes its base. */
  const augmentBlossom = (b: number, v: number): void => {
    let t = v;
    while (blossomParent[t] !== b) t = blossomParent[t]!;
    if (t >= nVertex) augmentBlossom(t, v);

    const childs = blossomChilds[b]!;
    const endps = blossomEndps[b]!;
    const i = childs.indexOf(t);
    let j = i;
    let jStep: number;
    let endpTrick: number;
    if (i & 1) {
      j -= childs.length;
      jStep = 1;
      endpTrick = 0;
    } else {
      jStep = -1;
      endpTrick = 1;
    }
    while (j !== 0) {
      j += jStep;
      let child = at(childs, j);
      const p = at(endps, j - endpTrick) ^ endpTrick;
      if (child >= nVertex) augmentBlossom(child, endpoint[p]!);
      j += jStep;
      child = at(childs, j);
      if (child >= nVertex) augmentBlossom(child, endpoint[p ^ 1]!);
      mate[endpoint[p]!] = p ^ 1;
      mate[endpoint[p ^ 1]!] = p;
    }
    // Rotate so the new base comes first.
    blossomChilds[b] = [...childs.slice(i), ...childs.slice(0, i)];
    blossomEndps[b] = [...endps.slice(i), ...endps.slice(0, i)];
    blossomBase[b] = blossomBase[blossomChilds[b]![0]!]!;
  };

  /** Flips every edge along the augmenting path through edge k, growing the matching by one. */
  const augmentMatching = (k: number): void => {
    const [v, w] = edges[k]!;
    for (const [start, startP] of [
      [v, 2 * k + 1],
      [w, 2 * k],
    ] as const) {
      let s: number = start;
      let p: number = startP;
      for (;;) {
        const bs = inBlossom[s]!;
        if (bs >= nVertex) augmentBlossom(bs, s);
        mate[s] = p;
        if (labelEnd[bs] === -1) break; // reached a single vertex
        const t = endpoint[labelEnd[bs]!]!;
        const bt = inBlossom[t]!;
        s = endpoint[labelEnd[bt]!]!;
        const j = endpoint[labelEnd[bt]! ^ 1]!;
        if (bt >= nVertex) augmentBlossom(bt, j);
        mate[j] = labelEnd[bt]!;
        p = labelEnd[bt]! ^ 1;
      }
    }
  };

  const minVertexDual = (): number => {
    let min = Infinity;
    for (let v = 0; v < nVertex; v++) min = Math.min(min, dualVar[v]!);
    return min;
  };

  // Each stage finds one augmenting path, so at most n stages are needed.
  for (let stage = 0; stage < nVertex; stage++) {
    label.fill(0);
    bestEdge.fill(-1);
    for (let b = nVertex; b < 2 * nVertex; b++) blossomBestEdges[b] = null;
    allowEdge.fill(false);
    queue = [];

    // Every single vertex is the root of an alternating tree.
    for (let v = 0; v < nVertex; v++) {
      if (mate[v] === -1 && label[inBlossom[v]!] === 0) assignLabel(v, 1, -1);
    }

    let augmented = false;
    for (;;) {
      // Grow the alternating trees along tight edges.
      while (queue.length > 0 && !augmented) {
        const v = queue.pop()!;
        for (const p of neighbEnd[v]!) {
          const k = p >> 1;
          const w = endpoint[p]!;
          if (inBlossom[v] === inBlossom[w]) continue; // edge inside a blossom

          let kSlack = 0;
          if (!allowEdge[k]) {
            kSlack = slack(k);
            if (kSlack <= 0) allowEdge[k] = true;
          }

          if (allowEdge[k]) {
            if (label[inBlossom[w]!] === 0) {
              // w is free: it becomes T and its mate S.
              assignLabel(w, 2, p ^ 1);
            } else if (label[inBlossom[w]!] === 1) {
              // Two S-vertices meet: a new blossom, or an augmenting path.
              const base = scanBlossom(v, w);
              if (base >= 0) {
                addBlossom(base, k);
              } else {
                augmentMatching(k);
                augmented = true;
                break;
              }
            } else if (label[w] === 0) {
              // w sits inside a T-blossom but hasn't been reached yet; remember how.
              label[w] = 2;
              labelEnd[w] = p ^ 1;
            }
          } else if (label[inBlossom[w]!] === 1) {
            const b = inBlossom[v]!;
            if (bestEdge[b] === -1 || kSlack < slack(bestEdge[b]!)) bestEdge[b] = k;
          } else if (label[w] === 0) {
            if (bestEdge[w] === -1 || kSlack < slack(bestEdge[w]!)) bestEdge[w] = k;
          }
        }
      }
      if (augmented) break;

      // No augmenting path along tight edges: adjust the duals by the
      // smallest delta that changes something.
      let deltaType = -1;
      let delta = 0;
      let deltaEdge = -1;
      let deltaBlossom = -1;

      // delta1: the smallest vertex dual (stop: the matching is optimal).
      if (!maxCardinality) {
        deltaType = 1;
        delta = minVertexDual();
      }
      // delta2: least slack from an S-vertex to a free vertex.
      for (let v = 0; v < nVertex; v++) {
        if (label[inBlossom[v]!] === 0 && bestEdge[v] !== -1) {
          const d = slack(bestEdge[v]!);
          if (deltaType === -1 || d < delta) {
            delta = d;
            deltaType = 2;
            deltaEdge = bestEdge[v]!;
          }
        }
      }
      // delta3: half the least slack between two different S-blossoms.
      for (let b = 0; b < 2 * nVertex; b++) {
        if (blossomParent[b] === -1 && label[b] === 1 && bestEdge[b] !== -1) {
          const d = slack(bestEdge[b]!) / 2; // even when weights are integers
          if (deltaType === -1 || d < delta) {
            delta = d;
            deltaType = 3;
            deltaEdge = bestEdge[b]!;
          }
        }
      }
      // delta4: the smallest dual of a T-blossom (it would go negative: expand it).
      for (let b = nVertex; b < 2 * nVertex; b++) {
        if (
          blossomBase[b]! >= 0 &&
          blossomParent[b] === -1 &&
          label[b] === 2 &&
          (deltaType === -1 || dualVar[b]! < delta)
        ) {
          delta = dualVar[b]!;
          deltaType = 4;
          deltaBlossom = b;
        }
      }
      if (deltaType === -1) {
        // Maximum cardinality reached; one last update keeps the duals feasible.
        deltaType = 1;
        delta = Math.max(0, minVertexDual());
      }

      for (let v = 0; v < nVertex; v++) {
        const l = label[inBlossom[v]!];
        if (l === 1) dualVar[v] = dualVar[v]! - delta;
        else if (l === 2) dualVar[v] = dualVar[v]! + delta;
      }
      for (let b = nVertex; b < 2 * nVertex; b++) {
        if (blossomBase[b]! >= 0 && blossomParent[b] === -1) {
          if (label[b] === 1) dualVar[b] = dualVar[b]! + delta;
          else if (label[b] === 2) dualVar[b] = dualVar[b]! - delta;
        }
      }

      if (deltaType === 1) break;
      if (deltaType === 2) {
        allowEdge[deltaEdge] = true;
        let [i, j] = edges[deltaEdge]!;
        if (label[inBlossom[i]!] === 0) [i, j] = [j, i];
        queue.push(i);
      } else if (deltaType === 3) {
        allowEdge[deltaEdge] = true;
        queue.push(edges[deltaEdge]![0]);
      } else {
        expandBlossom(deltaBlossom, false);
      }
    }

    if (!augmented) break;

    // End of stage: expand S-blossoms whose dual reached zero.
    for (let b = nVertex; b < 2 * nVertex; b++) {
      if (blossomParent[b] === -1 && blossomBase[b]! >= 0 && label[b] === 1 && dualVar[b] === 0) {
        expandBlossom(b, true);
      }
    }
  }

  // Convert matched endpoints into matched vertices.
  return mate.map((p) => (p >= 0 ? endpoint[p]! : -1));
}
