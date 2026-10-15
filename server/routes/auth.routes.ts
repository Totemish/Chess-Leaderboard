import { Router } from 'express';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { authMiddleware } from '../middleware/auth.middleware';
import { ConflictError, ForbiddenError, NotFoundError, TooManyRequestsError, BadRequestError } from '../lib/errors';
import { parseChessUsername } from '../lib/validate';
import { syncPlayer, type ChessComClient, type ChessComProfile } from '../services/chess.service';
import { broadcastSync } from '../services/cron.service';
import { invalidateLeaderboardCache } from '../services/redis.service';
import type { MemberService } from '../services/member.service';
import { profileShowsCode, verificationCode } from '../domain/ownership';

const DAY_MS = 86_400_000;
const SELF_SYNC_COOLDOWN_MS = 60_000;

interface AuthRouteDeps {
  db: PrismaClient;
  members: MemberService;
  chess: ChessComClient;
  io: Server;
  authSecret: string;
}

/** A closed account can't join, and couldn't show a code anyway. */
function assertOpen(remote: ChessComProfile) {
  if (remote.status?.startsWith('closed')) {
    throw new BadRequestError(`Chess.com has closed ${remote.username}'s account, so it can't join the leaderboard.`);
  }
}

export function createAuthRouter({ db, members, chess, io, authSecret }: AuthRouteDeps) {
  const router = Router();
  const lastSelfSync = new Map<string, number>();

  const assertNotLinkedElsewhere = async (profileId: string, memberId: string) => {
    const holder = await db.user.findUnique({ where: { chessProfileId: profileId }, select: { id: true } });
    if (holder && holder.id !== memberId) {
      throw new ConflictError('This Chess.com account is already linked to another member.');
    }
  };

  // The signed-in member: their sign-in methods and the last 90 days of rating history.
  router.get('/me', authMiddleware, async (req, res) => {
    const member = await members.resolve(req.user!);
    const since = new Date(Date.now() - 90 * DAY_MS);
    const data = await db.user.findUnique({
      where: { id: member.id },
      include: {
        identities: { select: { provider: true, email: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
        chessProfile: {
          include: { ratingHistories: { where: { date: { gte: since } }, orderBy: { date: 'asc' } } },
        },
      },
    });
    res.json({ success: true, data });
  });

  // Step 1 of linking: check the account exists and hand out the ownership code.
  router.post('/link-profile/challenge', authMiddleware, async (req, res) => {
    const member = await members.resolve(req.user!);
    members.assertInstituteMember(member, req.user!);
    const username = parseChessUsername(req.body?.chessUsername);
    const remote = await chess.getProfile(username);
    if (!remote) throw new NotFoundError(`Chess.com has no player called "${username}".`);
    assertOpen(remote);
    await assertNotLinkedElsewhere(username.toLowerCase(), member.id);
    res.json({
      success: true,
      data: { username: remote.username, code: verificationCode(authSecret, member.id, username) },
    });
  });

  // Step 2: confirm the code is on the Chess.com profile, then link it (adding the player if new).
  router.post('/link-profile', authMiddleware, async (req, res) => {
    const member = await members.resolve(req.user!);
    members.assertInstituteMember(member, req.user!);
    const username = parseChessUsername(req.body?.chessUsername);
    await assertNotLinkedElsewhere(username.toLowerCase(), member.id);

    const remote = await chess.getProfile(username);
    if (!remote) throw new NotFoundError(`Chess.com has no player called "${username}".`);
    assertOpen(remote);
    const code = verificationCode(authSecret, member.id, username);
    if (!profileShowsCode(remote, code)) {
      throw new BadRequestError(
        `${code} isn't on ${remote.username}'s Chess.com profile yet. Add it to the Location field, save, and try again.`
      );
    }

    // Proving ownership also brings back a player an admin had removed.
    const synced = await syncPlayer(chess, username, { restore: true });
    if (!synced) throw new NotFoundError(`Chess.com has no player called "${username}".`);
    try {
      const linked = await db.user.update({
        where: { id: member.id },
        data: { chessProfileId: synced.profile.id },
        include: { chessProfile: true },
      });
      // The leaderboard shows members' names, so it changes even when the ratings didn't.
      await invalidateLeaderboardCache();
      broadcastSync(io, synced);
      res.json({ success: true, data: linked });
    } catch (error) {
      // The unique index on chessProfileId is the final word if two members race.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('This Chess.com account is already linked to another member.');
      }
      throw error;
    }
  });

  router.delete('/unlink-profile', authMiddleware, async (req, res) => {
    const member = await members.resolve(req.user!);
    const data = await db.user.update({ where: { id: member.id }, data: { chessProfileId: null } });
    await invalidateLeaderboardCache();
    res.json({ success: true, data });
  });

  // Pull fresh ratings now. Admins can sync anyone (that is how they add
  // players); members only their own linked account, at most once a minute.
  router.post('/sync/:username', authMiddleware, async (req, res) => {
    const username = parseChessUsername(req.params.username);
    const profileId = username.toLowerCase();
    const member = await members.find(req.user!.id);
    const isAdmin = member?.role === 'ADMIN';

    if (!isAdmin) {
      if (member?.chessProfileId !== profileId) {
        throw new ForbiddenError('You can only refresh your own linked Chess.com account.');
      }
      const last = lastSelfSync.get(profileId) ?? 0;
      if (Date.now() - last < SELF_SYNC_COOLDOWN_MS) {
        throw new TooManyRequestsError('Ratings were refreshed less than a minute ago. Try again shortly.');
      }
      lastSelfSync.set(profileId, Date.now());
    }

    // An admin adding a player also brings back one they removed earlier.
    const result = await syncPlayer(chess, username, { restore: isAdmin });
    if (!result) throw new NotFoundError(`Chess.com has no player called "${username}".`);
    if (result.changed) await invalidateLeaderboardCache();
    broadcastSync(io, result);
    res.json({ success: true, data: result.profile });
  });

  return router;
}
