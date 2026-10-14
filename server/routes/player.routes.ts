import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { BadRequestError, NotFoundError } from '../lib/errors';
import { parseChessUsername, parseTimeControl } from '../lib/validate';
import { getLeaderboard, LEADERBOARD_PAGE_SIZE } from '../services/redis.service';

const DAY_MS = 86_400_000;

export function createPlayerRouter({ db }: { db: PrismaClient }) {
  const router = Router();

  // Ranked players for one time control. Cursor-paged by player id; ?search= filters by name.
  router.get('/leaderboard/:format', async (req, res) => {
    const format = parseTimeControl(req.params.format);
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 50) || undefined : undefined;

    const data = await getLeaderboard(format, cursor, search);
    const last = data[data.length - 1];
    const nextCursor = data.length === LEADERBOARD_PAGE_SIZE && last ? last.id : null;
    res.json({ success: true, data, nextCursor });
  });

  router.get('/players', async (_req, res) => {
    const players = await db.chessProfile.findMany({ orderBy: { username: 'asc' } });
    res.json({ success: true, data: players });
  });

  // One player with their rating history (?days=, default a year, so the payload stays bounded).
  router.get('/players/:username', async (req, res) => {
    const username = parseChessUsername(req.params.username);
    const days = req.query.days === undefined ? 365 : Number(req.query.days);
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new BadRequestError('days must be between 1 and 3650.');

    const player = await db.chessProfile.findUnique({
      where: { id: username.toLowerCase() },
      include: {
        ratingHistories: {
          where: { date: { gte: new Date(Date.now() - days * DAY_MS) } },
          orderBy: { date: 'asc' },
        },
      },
    });
    if (!player) throw new NotFoundError('Player not found.');
    res.json({ success: true, data: player });
  });

  return router;
}
