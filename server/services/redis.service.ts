import Redis from 'ioredis';
import type { ChessProfile, Prisma } from '@prisma/client';
import { config } from '../config';
import { prisma } from './db.service';
import type { TimeControl } from '../lib/validate';

// Initialize Redis only if the URL is provided (e.g. from Upstash)
export const redis = config.redisUrl ? new Redis(config.redisUrl) : null;

if (redis) {
  redis.on('error', (err) => console.error('Redis Client Error', err));
  console.log('Redis initialized');
} else {
  console.log('Redis URL not provided. Running without caching layer.');
}

const CACHE_EXPIRATION = 60 * 5; // 5 minutes
export const LEADERBOARD_PAGE_SIZE = 100;

export type LeaderboardRow = ChessProfile & { user: { name: string | null } | null };

export async function getLeaderboard(format: TimeControl, cursor?: string, search?: string): Promise<LeaderboardRow[]> {
  const cacheKey = `leaderboard:${format}`;
  const isDefaultQuery = !cursor && !search;

  if (redis && isDefaultQuery) {
    try {
      const cachedData = await redis.get(cacheKey);
      if (cachedData) return JSON.parse(cachedData) as LeaderboardRow[];
    } catch (error) {
      console.warn(`Redis GET failed for ${cacheKey}:`, error);
    }
  }

  // Typed maps instead of dynamic string keys keep Prisma's types intact.
  const orderByMap = {
    rapid: { rapidRating: 'desc' as const },
    blitz: { blitzRating: 'desc' as const },
    bullet: { bulletRating: 'desc' as const },
  };
  const baseWhereMap = {
    rapid: { rapidRating: { not: null } },
    blitz: { blitzRating: { not: null } },
    bullet: { bulletRating: { not: null } },
  };

  // Closed, missing and removed players keep their rows but aren't ranked.
  const where: Prisma.ChessProfileWhereInput = { ...baseWhereMap[format], status: 'ACTIVE' };
  if (search) {
    where.OR = [
      { username: { contains: search, mode: 'insensitive' } },
      { displayName: { contains: search, mode: 'insensitive' } },
    ];
  }

  const leaderboard = await prisma.chessProfile.findMany({
    orderBy: [orderByMap[format], { id: 'asc' }], // id breaks ties for stable cursors
    where,
    take: LEADERBOARD_PAGE_SIZE,
    include: { user: { select: { name: true } } },
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
  });

  if (redis && isDefaultQuery) {
    try {
      await redis.set(cacheKey, JSON.stringify(leaderboard), 'EX', CACHE_EXPIRATION);
    } catch (error) {
      console.warn(`Redis SET failed for ${cacheKey}:`, error);
    }
  }

  return leaderboard;
}

export async function invalidateLeaderboardCache() {
  if (!redis) return;
  try {
    await redis.del('leaderboard:rapid', 'leaderboard:blitz', 'leaderboard:bullet');
  } catch (error) {
    console.warn('Redis DEL failed when invalidating cache:', error);
  }
}
