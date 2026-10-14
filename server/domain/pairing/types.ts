export type Colour = 'white' | 'black';

export interface PairingPlayer {
  id: string;
  /** Points scored before the round being paired. */
  score: number;
  /** Rating used to rank players within a score group (the seed rating). */
  rating: number;
}

/** A game from an earlier round. `blackId` is null for a bye. */
export interface PastGame {
  round: number;
  whiteId: string;
  blackId: string | null;
}

/** One board of the new round. `blackId` is null for a bye. */
export interface Pairing {
  whiteId: string;
  blackId: string | null;
}

/**
 * A pairing system (Strategy pattern). The tournament service depends on this
 * interface only, so Swiss could sit beside round-robin or knockout systems.
 */
export interface PairingStrategy {
  readonly name: string;
  /** Pairs the next round. Every player appears in exactly one pairing. */
  pairRound(players: readonly PairingPlayer[], history: readonly PastGame[]): Pairing[];
}
