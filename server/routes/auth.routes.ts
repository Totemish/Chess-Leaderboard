import { Router } from 'express';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { authMiddleware, type AuthUser } from '../middleware/auth.middleware';
import { ConflictError, ForbiddenError, NotFoundError, TooManyRequestsError, BadRequestError } from '../lib/errors';
import { parseChessUsername } from '../lib/validate';
import { syncPlayer, type ChessComClient } from '../services/chess.service';
import { invalidateLeaderboardCache } from '../services/redis.service';
import { profileShowsCode, verificationCode } from '../domain/ownership';

const DAY_MS = 86_400_000;
const SELF_SYNC_COOLDOWN_MS = 60_000;

interface AuthRouteDeps {
  db: PrismaClient;
  chess: ChessComClient;
  io: Server;
  authSecret: string;
  instituteDomain: string;
}

export function createAuthRouter({ db, chess, io, authSecret, instituteDomain }: AuthRouteDeps) {
  const router = Router();
  const lastSelfSync = new Map<string, number>();

  /** Creates the member's row on first sight. An upsert, so parallel first requests can't collide. */
  const ensureMember = (user: AuthUser) => {
    const split = user.id.indexOf(':');
    return db.user.upsert({
      where: { authId: user.id },
      update: {},
      create: {
        authId: user.id,
        email: user.email ?? null,
        name: user.name ?? null,
        image: user.image ?? null,
        provider: split > 0 ? user.id.slice(0, split) : null,
        providerAccountId: split > 0 ? user.id.slice(split + 1) : null,
      },
    });
  };

  const assertInstituteMember = (user: AuthUser) => {
    if (!user.email?.endsWith(instituteDomain)) {
      throw new ForbiddenError(`Only ${instituteDomain} accounts can join the leaderboard.`);
    }
    if (!user.emailVerified) {
      throw new ForbiddenError(
        `Your sign-in provider hasn't confirmed ${user.email}. Sign out, then sign in again with the Google account for your ${instituteDomain} email.`
      );
    }
  };

  const assertNotLinkedElsewhere = async (profileId: string, authId: string) => {
    const holder = await db.user.findUnique({ where: { chessProfileId: profileId }, select: { authId: true } });
    if (holder && holder.authId !== authId) {
      throw new ConflictError('This Chess.com account is already linked to another member.');
    }
  };

  // The signed-in member, with the last 90 days of rating history.
  router.get('/me', authMiddleware, async (req, res) => {
    const member = await ensureMember(req.user!);
    const since = new Date(Date.now() - 90 * DAY_MS);
    const data = await db.user.findUnique({
      where: { id: member.id },
      include: {
        chessProfile: {
          include: { ratingHistories: { where: { date: { gte: since } }, orderBy: { date: 'asc' } } },
        },
      },
    });
    res.json({ success: true, data });
  });

  // Step 1 of linking: check the account exists and hand out the ownership code.
  router.post('/link-profile/challenge', authMiddleware, async (req, res) => {
    const user = req.user!;
    assertInstituteMember(user);
    const username = parseChessUsername(req.body?.chessUsername);
    const remote = await chess.getProfile(username);
    if (!remote) throw new NotFoundError(`Chess.com has no player called "${username}".`);
    await assertNotLinkedElsewhere(username.toLowerCase(), user.id);
    res.json({
      success: true,
      data: { username: remote.username, code: verificationCode(authSecret, user.id, username) },
    });
  });

  // Step 2: confirm the code is on the Chess.com profile, then link it (adding the player if new).
  router.post('/link-profile', authMiddleware, async (req, res) => {
    const user = req.user!;
    assertInstituteMember(user);
    const username = parseChessUsername(req.body?.chessUsername);
    const profileId = username.toLowerCase();
    await assertNotLinkedElsewhere(profileId, user.id);

    const remote = await chess.getProfile(username);
    if (!remote) throw new NotFoundError(`Chess.com has no player called "${username}".`);
    const code = verificationCode(authSecret, user.id, username);
    if (!profileShowsCode(remote, code)) {
      throw new BadRequestError(
        `${code} isn't on ${remote.username}'s Chess.com profile yet. Add it to the Location field, save, and try again.`
      );
    }

    const synced = await syncPlayer(chess, username);
    if (!synced) throw new NotFoundError(`Chess.com has no player called "${username}".`);
    await ensureMember(user);
    try {
      const member = await db.user.update({
        where: { authId: user.id },
        data: { chessProfileId: profileId },
        include: { chessProfile: true },
      });
      await invalidateLeaderboardCache();
      io.emit('player_updated', synced.profile);
      res.json({ success: true, data: member });
    } catch (error) {
      // The unique index on chessProfileId is the final word if two members race.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('This Chess.com account is already linked to another member.');
      }
      throw error;
    }
  });

  router.delete('/unlink-profile', authMiddleware, async (req, res) => {
    await ensureMember(req.user!);
    const member = await db.user.update({ where: { authId: req.user!.id }, data: { chessProfileId: null } });
    res.json({ success: true, data: member });
  });

  // Pull fresh ratings now. Admins can sync anyone (that is how they add
  // players); members only their own linked account, at most once a minute.
  router.post('/sync/:username', authMiddleware, async (req, res) => {
    const username = parseChessUsername(req.params.username);
    const profileId = username.toLowerCase();
    const member = await db.user.findUnique({ where: { authId: req.user!.id } });
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

    const result = await syncPlayer(chess, username);
    if (!result) throw new NotFoundError(`Chess.com has no player called "${username}".`);
    if (result.changed) await invalidateLeaderboardCache();
    io.emit('player_updated', result.profile);
    res.json({ success: true, data: result.profile });
  });

  return router;
}
