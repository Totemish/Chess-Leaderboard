import { Router } from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth.middleware';
import { parseChessUsername, parseGameResult, parseTimeControl, parseTournamentName, routeParam } from '../lib/validate';
import type { MemberService } from '../services/member.service';
import type { TournamentService } from '../services/tournament.service';

/** HTTP layer only: parse input, call the service, send JSON. Rules live in TournamentService. */
export function createTournamentRouter({ members, tournaments }: { members: MemberService; tournaments: TournamentService }) {
  const router = Router();
  const admin = requireAdmin(members);

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

  // Admins build the field, so nobody can enter an event just to disrupt it.
  router.post('/:id/players', authMiddleware, admin, async (req, res) => {
    const username = parseChessUsername(req.body?.username);
    const entry = await tournaments.addPlayer(routeParam(req.params, 'id'), username.toLowerCase());
    res.status(201).json({ success: true, data: entry });
  });

  router.delete('/:id/players/:username', authMiddleware, admin, async (req, res) => {
    const username = parseChessUsername(routeParam(req.params, 'username'));
    await tournaments.removePlayer(routeParam(req.params, 'id'), username.toLowerCase());
    res.json({ success: true });
  });

  router.post('/:id/generate-round', authMiddleware, admin, async (req, res) => {
    res.json({ success: true, data: await tournaments.pairNextRound(routeParam(req.params, 'id')) });
  });

  router.post('/:id/matches/:matchId/result', authMiddleware, admin, async (req, res) => {
    const result = parseGameResult(req.body?.result);
    await tournaments.recordResult(routeParam(req.params, 'id'), routeParam(req.params, 'matchId'), result);
    res.json({ success: true });
  });

  // POST enters a result once; PUT corrects one already entered.
  router.put('/:id/matches/:matchId/result', authMiddleware, admin, async (req, res) => {
    const result = parseGameResult(req.body?.result);
    await tournaments.changeResult(routeParam(req.params, 'id'), routeParam(req.params, 'matchId'), result);
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
