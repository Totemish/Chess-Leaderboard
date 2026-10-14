/**
 * Colours for a numbered square in a board-file column (leaderboard ranks,
 * pairing boards, standings places). Odd numbers sit on the accent square,
 * so 1 always gets it, like a1 on a real board.
 */
export function squareTone(n: number): string {
  return n % 2 === 1 ? 'bg-square text-on-square' : 'bg-square-alt text-ink';
}
