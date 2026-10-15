/** Whether a player is on the leaderboard (mirrors the PlayerStatus enum in the schema). */
export type PlayerStatus = 'ACTIVE' | 'CLOSED' | 'CLOSED_FAIR_PLAY' | 'MISSING' | 'REMOVED';

export interface Listing {
  status: PlayerStatus;
  /** First sync that couldn't find the account; null while Chess.com finds it. */
  missingSince: Date | null;
}

/** What one sync learned about the account. */
export type Sighting =
  /** Chess.com returned the profile, with its account status ("basic", "premium", "closed", …). */
  | { found: true; accountStatus?: string | undefined }
  /** Chess.com has no such player (404 or 410). */
  | { found: false };

/** How long Chess.com must keep answering "no such player" before a player is hidden. */
export const MISSING_GRACE_MS = 24 * 60 * 60 * 1000;

export const NEW_LISTING: Listing = { status: 'ACTIVE', missingSince: null };

/**
 * The player's listing after a sync, as a small state machine:
 *
 * - Chess.com saying the account is closed hides the player at once.
 * - "No such player" hides them only after MISSING_GRACE_MS of misses, so a
 *   single bad answer (an outage, a rename in progress) never does.
 * - Automatic hides undo themselves when Chess.com finds the account again.
 *   An admin's removal sticks, unless `restore` is set: an admin adding the
 *   player again, or its owner linking it.
 */
export function nextListing(current: Listing, seen: Sighting, now: Date, restore = false): Listing {
  if (!seen.found) {
    const missingSince = current.missingSince ?? now;
    const overdue = now.getTime() - missingSince.getTime() >= MISSING_GRACE_MS;
    return { status: current.status === 'ACTIVE' && overdue ? 'MISSING' : current.status, missingSince };
  }
  if (current.status === 'REMOVED' && !restore) return { status: 'REMOVED', missingSince: null };
  return { status: closedStatus(seen.accountStatus) ?? 'ACTIVE', missingSince: null };
}

function closedStatus(accountStatus: string | undefined): PlayerStatus | null {
  if (accountStatus === 'closed:fair_play_violations') return 'CLOSED_FAIR_PLAY';
  if (accountStatus?.startsWith('closed')) return 'CLOSED';
  return null;
}
