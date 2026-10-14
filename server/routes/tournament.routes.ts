import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { authMiddleware, requireAdmin } from '../middleware/auth.middleware';
import { parseGameResult, parseTimeControl, parseTournamentName, routeParam } from '../lib/validate';
import type { TournamentService } from '../services/tournament.service';

/** HTTP layer only: parse input, call the service, send JSON. Rules live in TournamentService. */
export function createTournamentRouter({ db, tournaments }: { db: PrismaClient; tournaments: TournamentService }) {
  const router = Router();
  const admin = requireAdmin(db);

  router.get('/', async (_req, res) => {
    res.json({ success: true, data: await tournaments.list() });
  });

  router.get('/:id', async (req, res) => {
    res.json({ success: true, data: await tournaments.get(routeParam(req.params, 'id')) });
  });

  router.post('/', authMiddleware, admin, async (req, res) => {
    const name = parseTournamentName(req.body?.name);
    const format = req.body?.format === undefined ? 'rapid' : parseTimeControl(req.body.format);
    res.status(201).json({ success: true, data: await tournaments.create(name, format) });
  });

  router.post('/:id/join', authMiddleware, async (req, res) => {
    res.json({ success: true, data: await tournaments.join(routeParam(req.params, 'id'), req.user!.id) });
  });

  router.post('/:id/generate-round', authMiddleware, admin, async (req, res) => {
    res.json({ success: true, data: await tournaments.pairNextRound(routeParam(req.params, 'id')) });
  });

  router.post('/:id/matches/:matchId/result', authMiddleware, admin, async (req, res) => {
    const result = parseGameResult(req.body?.result);
    await tournaments.recordResult(routeParam(req.params, 'id'), routeParam(req.params, 'matchId'), result);
    res.json({ success: true });
  });

  router.post('/:id/finish', authMiddleware, admin, async (req, res) => {
    res.json({ success: true, data: await tournaments.finish(routeParam(req.params, 'id')) });
  });

  router.delete('/:id', authMiddleware, admin, async (req, res) => {
    await tournaments.remove(routeParam(req.params, 'id'));
    res.json({ success: true });
  });

  return router;
}
