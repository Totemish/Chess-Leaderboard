import type { ChessProfile, Prisma } from '@prisma/client';
import { prisma } from './db.service';
import { UpstreamError } from '../lib/errors';

const API_BASE = 'https://api.chess.com/pub';
const DEFAULT_AVATAR = 'https://www.chess.com/bundles/web/images/user-image.svg';
const FORMATS = ['rapid', 'blitz', 'bullet'] as const;

export interface ChessComProfile {
  username: string;
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
}

const countryCode = (url?: string) => (url ? url.slice(url.lastIndexOf('/') + 1).toUpperCase() : null);

/**
 * Pulls one player's profile and ratings from Chess.com into the database and
 * records today's rating history. Returns null if Chess.com has no such player.
 * The two requests run one after the other: Chess.com allows unlimited serial
 * requests but may reject parallel ones.
 */
export async function syncPlayer(client: ChessComClient, username: string, displayName?: string): Promise<SyncResult | null> {
  const remote = await client.getProfile(username);
  if (!remote) return null;
  const stats = (await client.getStats(username)) ?? {};

  const id = username.trim().toLowerCase();
  const ratings = {
    rapid: stats.chess_rapid?.last?.rating ?? null,
    blitz: stats.chess_blitz?.last?.rating ?? null,
    bullet: stats.chess_bullet?.last?.rating ?? null,
  };
  const shared = {
    avatarUrl: remote.avatar || DEFAULT_AVATAR,
    country: countryCode(remote.country),
    title: remote.title || null,
  };

  const existing = await prisma.chessProfile.findUnique({ where: { id } });

  const update: Prisma.ChessProfileUpdateInput = { ...shared, lastUpdated: new Date() };
  if (displayName) update.displayName = displayName;
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
      displayName: displayName || remote.name || remote.username,
      ...shared,
      rapidRating: ratings.rapid,
      blitzRating: ratings.blitz,
      bulletRating: ratings.bullet,
    },
  });

  // One history row per player, format and UTC day; later syncs that day overwrite it.
  const today = new Date();
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

  const changed =
    !existing ||
    existing.rapidRating !== profile.rapidRating ||
    existing.blitzRating !== profile.blitzRating ||
    existing.bulletRating !== profile.bulletRating ||
    existing.avatarUrl !== profile.avatarUrl ||
    existing.title !== profile.title ||
    existing.displayName !== profile.displayName;

  return { profile, changed };
}
