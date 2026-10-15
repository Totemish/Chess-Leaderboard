import type { ChessProfile, Prisma } from '@prisma/client';
import { prisma } from './db.service';
import { UpstreamError } from '../lib/errors';
import { nextListing, NEW_LISTING } from '../domain/player-status';

const API_BASE = 'https://api.chess.com/pub';
const DEFAULT_AVATAR = 'https://www.chess.com/bundles/web/images/user-image.svg';
const FORMATS = ['rapid', 'blitz', 'bullet'] as const;

export interface ChessComProfile {
  username: string;
  /** Chess.com's permanent account number; it survives username changes. */
  player_id?: number;
  /** "basic", "premium", "staff", … or "closed" / "closed:fair_play_violations". */
  status?: string;
  name?: string;
  avatar?: string;
  /** e.g. "https://api.chess.com/pub/country/IN" */
  country?: string;
  title?: string;
  location?: string;
}

interface RatingRecord {
  last?: { rating?: number };
}

export interface ChessComStats {
  chess_rapid?: RatingRecord;
  chess_blitz?: RatingRecord;
  chess_bullet?: RatingRecord;
}

/**
 * Adapter for Chess.com's public API. Returns null for players Chess.com
 * doesn't know, and throws UpstreamError for anything else, so callers can
 * tell "no such player" apart from "Chess.com is down".
 */
export class ChessComClient {
  constructor(
    private readonly userAgent: string,
    private readonly timeoutMs = 10_000
  ) {}

  getProfile(username: string): Promise<ChessComProfile | null> {
    return this.get<ChessComProfile>(`/player/${encodeURIComponent(username.toLowerCase())}`);
  }

  getStats(username: string): Promise<ChessComStats | null> {
    return this.get<ChessComStats>(`/player/${encodeURIComponent(username.toLowerCase())}/stats`);
  }

  private async get<T>(path: string): Promise<T | null> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        // Without a timeout, one hung request would stall the whole sync loop.
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new UpstreamError(`Chess.com didn't respond (${error instanceof Error ? error.message : 'network error'}).`);
    }
    if (response.status === 404 || response.status === 410) return null;
    if (response.status === 429) throw new UpstreamError('Chess.com is rate-limiting requests. Try again shortly.');
    if (!response.ok) throw new UpstreamError(`Chess.com responded with ${response.status}.`);
    return (await response.json()) as T;
  }
}

export interface SyncResult {
  profile: ChessProfile;
  /** True when anything shown on the leaderboard changed. */
  changed: boolean;
  /**
   * True when the player joined or left the leaderboard, or was renamed: open
   * pages should refetch the board instead of patching one row.
   */
  relisted: boolean;
}

export interface SyncOptions {
  /** Bring back a player an admin removed: an admin adding them again, or their owner linking them. */
  restore?: boolean;
}

const countryCode = (url?: string) => (url ? url.slice(url.lastIndexOf('/') + 1).toUpperCase() : null);

/**
 * Pulls one player's profile and ratings from Chess.com into the database and
 * records today's rating history. Returns null if Chess.com has no such player
 * (recordMissing handles players it used to know).
 *
 * Accounts Chess.com has closed are kept but leave the leaderboard (see
 * nextListing). A renamed account is recognised by its player_id and moved
 * to the new username along with its history.
 *
 * The two requests run one after the other: Chess.com allows unlimited serial
 * requests but may reject parallel ones.
 */
export async function syncPlayer(
  client: ChessComClient,
  username: string,
  { restore = false }: SyncOptions = {}
): Promise<SyncResult | null> {
  const remote = await client.getProfile(username);
  if (!remote) return null;

  const now = new Date();
  // Chess.com's own spelling of the name, which differs from the request after a rename.
  const id = remote.username.toLowerCase();
  const { existing, renamed } = await findPlayer(remote, username.trim().toLowerCase());
  const listing = nextListing(existing ?? NEW_LISTING, { found: true, accountStatus: remote.status }, now, restore);

  // Hidden players keep their last ratings, so only listed ones need the stats request.
  const stats = listing.status === 'ACTIVE' ? ((await client.getStats(id)) ?? {}) : {};
  const ratings = {
    rapid: stats.chess_rapid?.last?.rating ?? null,
    blitz: stats.chess_blitz?.last?.rating ?? null,
    bullet: stats.chess_bullet?.last?.rating ?? null,
  };
  const shared = {
    avatarUrl: remote.avatar || DEFAULT_AVATAR,
    country: countryCode(remote.country),
    title: remote.title || null,
    ...listing,
    ...(remote.player_id ? { chessComId: remote.player_id } : {}),
  };

  const update: Prisma.ChessProfileUpdateInput = { ...shared, lastUpdated: now };
  // A missing rating means "no data this time", not "reset": keep the stored value.
  if (ratings.rapid !== null) update.rapidRating = ratings.rapid;
  if (ratings.blitz !== null) update.blitzRating = ratings.blitz;
  if (ratings.bullet !== null) update.bulletRating = ratings.bullet;

  const profile = await prisma.chessProfile.upsert({
    where: { id },
    update,
    create: {
      id,
      username: remote.username,
      displayName: remote.name || remote.username,
      ...shared,
      rapidRating: ratings.rapid,
      blitzRating: ratings.blitz,
      bulletRating: ratings.bullet,
    },
  });

  // One history row per player, format and UTC day; later syncs that day overwrite it.
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  for (const format of FORMATS) {
    const rating = ratings[format];
    if (rating === null) continue;
    await prisma.ratingHistory.upsert({
      where: { profileId_format_date: { profileId: id, format, date: today } },
      update: { rating },
      create: { profileId: id, format, rating, date: today },
    });
  }

  const relisted = !!existing && (renamed || (existing.status === 'ACTIVE') !== (profile.status === 'ACTIVE'));
  const changed =
    !existing ||
    relisted ||
    existing.rapidRating !== profile.rapidRating ||
    existing.blitzRating !== profile.blitzRating ||
    existing.bulletRating !== profile.bulletRating ||
    existing.avatarUrl !== profile.avatarUrl ||
    existing.title !== profile.title ||
    existing.displayName !== profile.displayName;

  return { profile, changed, relisted };
}

/**
 * Records that Chess.com has no player by this name although we track one.
 * They stay listed through a grace period, then are hidden (see nextListing).
 * Returns null when we don't track the player either.
 */
export async function recordMissing(username: string, now = new Date()): Promise<SyncResult | null> {
  const id = username.trim().toLowerCase();
  const existing = await prisma.chessProfile.findUnique({ where: { id } });
  if (!existing) return null;

  const listing = nextListing(existing, { found: false }, now);
  const same = listing.status === existing.status && listing.missingSince?.getTime() === existing.missingSince?.getTime();
  const profile = same ? existing : await prisma.chessProfile.update({ where: { id }, data: listing });
  const relisted = profile.status !== existing.status;
  return { profile, changed: relisted, relisted };
}

/**
 * Our row for a Chess.com account: by its current username, or else by its
 * permanent player_id. A row found by player_id under an old username is
 * moved to the new one; ON UPDATE CASCADE carries its rating history,
 * tournament games and member link along.
 */
async function findPlayer(remote: ChessComProfile, requestedId: string) {
  const id = remote.username.toLowerCase();
  const playerId = remote.player_id ?? null;
  const byName = await prisma.chessProfile.findUnique({ where: { id } });
  const byAccount = playerId ? await prisma.chessProfile.findUnique({ where: { chessComId: playerId } }) : null;

  if (byName) {
    if (byName.chessComId && playerId && byName.chessComId !== playerId) {
      // The name now belongs to a different Chess.com account. A member link
      // proved ownership of the old account, so it must not carry over.
      await prisma.user.updateMany({ where: { chessProfileId: id }, data: { chessProfileId: null } });
    }
    if (byAccount && byAccount.id !== id) {
      // Renamed, then added again under the new name: keep the current name's
      // row and free the id, so the old row simply goes missing.
      await prisma.chessProfile.update({ where: { id: byAccount.id }, data: { chessComId: null } });
    }
    return { existing: byName, renamed: false };
  }

  // Rows stored before player_ids were recorded are still found by the name asked for.
  const previous = byAccount ?? (requestedId !== id ? await prisma.chessProfile.findUnique({ where: { id: requestedId } }) : null);
  if (!previous) return { existing: null, renamed: false };
  const moved = await prisma.chessProfile.update({ where: { id: previous.id }, data: { id, username: remote.username } });
  return { existing: moved, renamed: true };
}
