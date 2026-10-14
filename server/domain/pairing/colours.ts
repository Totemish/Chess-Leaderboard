import type { Colour } from './types';

export type PreferenceStrength = 'none' | 'mild' | 'strong' | 'absolute';

export interface ColourPreference {
  colour: Colour | null;
  strength: PreferenceStrength;
  /** Whites minus blacks so far. */
  difference: number;
}

export const STRENGTH_ORDER: Record<PreferenceStrength, number> = { none: 0, mild: 1, strong: 2, absolute: 3 };

export const opposite = (colour: Colour): Colour => (colour === 'white' ? 'black' : 'white');

/**
 * A player's colour preference from the colours they have played (byes
 * excluded), following the FIDE Dutch system:
 * - absolute: two more of one colour, or the same colour twice in a row
 * - strong: one more of one colour
 * - mild: balanced, so alternate from the last game
 */
export function colourPreference(history: readonly Colour[]): ColourPreference {
  const whites = history.filter((c) => c === 'white').length;
  const difference = whites - (history.length - whites);
  const last = history[history.length - 1];
  const previous = history[history.length - 2];

  if (difference > 1) return { colour: 'black', strength: 'absolute', difference };
  if (difference < -1) return { colour: 'white', strength: 'absolute', difference };
  if (last && last === previous) return { colour: opposite(last), strength: 'absolute', difference };
  if (difference === 1) return { colour: 'black', strength: 'strong', difference };
  if (difference === -1) return { colour: 'white', strength: 'strong', difference };
  if (last) return { colour: opposite(last), strength: 'mild', difference };
  return { colour: null, strength: 'none', difference };
}

/**
 * Decides who plays White. `a` is the higher-ranked player. Rules, in order:
 * 1. Grant both preferences when they differ (or only one player has one).
 * 2. The stronger preference wins; between two absolutes, the wider imbalance.
 * 3. Alternate from the latest game in which the two had different colours.
 * 4. The higher-ranked player gets their preference.
 * With no history at all, the higher-ranked player takes White on even boards
 * and Black on odd ones, as FIDE alternates initial colours down the boards.
 */
export function allocateColours(
  a: { history: readonly Colour[]; preference: ColourPreference },
  b: { history: readonly Colour[]; preference: ColourPreference },
  higherRankIndex: number
): { aColour: Colour } {
  const pa = a.preference;
  const pb = b.preference;

  if (pa.colour === null && pb.colour === null) {
    return { aColour: higherRankIndex % 2 === 0 ? 'white' : 'black' };
  }
  if (pa.colour !== null && (pb.colour === null || pa.colour !== pb.colour)) return { aColour: pa.colour };
  if (pa.colour === null && pb.colour !== null) return { aColour: opposite(pb.colour) };

  // Both want the same colour.
  const wanted = pa.colour!;
  const sa = STRENGTH_ORDER[pa.strength];
  const sb = STRENGTH_ORDER[pb.strength];
  if (sa !== sb) return { aColour: sa > sb ? wanted : opposite(wanted) };
  if (pa.strength === 'absolute' && Math.abs(pa.difference) !== Math.abs(pb.difference)) {
    return { aColour: Math.abs(pa.difference) > Math.abs(pb.difference) ? wanted : opposite(wanted) };
  }
  for (let back = 1; back <= Math.min(a.history.length, b.history.length); back++) {
    const ca = a.history[a.history.length - back]!;
    const cb = b.history[b.history.length - back]!;
    if (ca !== cb) return { aColour: opposite(ca) };
  }
  return { aColour: wanted };
}
