/**
 * The auth routes' security rules, against a real database with a fake
 * Chess.com (a subclass of the real client, so the routes can't tell).
 *
 *   TEST_DATABASE_URL=postgres://…localhost… npm run test:integration
 *
 * Sign-ins are named "test:auth-…" (and "test-gh:auth-…" for a second
 * provider); players are "auth-…". Everything is deleted afterwards.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'set TEST_DATABASE_URL to run integration tests';
if (url && !/@(localhost|127\.0\.0\.1)[:/]/.test(url) && process.env.TEST_DATABASE_ALLOW_REMOTE !== 'true') {
  throw new Error('TEST_DATABASE_URL must point at a local, disposable database');
}

const SECRET = 'integration-test-secret';
let base = '';
let server: HttpServer;
let db: import('@prisma/client').PrismaClient;
let token: (sub: string, opts?: { email?: string; verified?: boolean }) => string;

interface RemoteAccount {
  playerId?: number;
  status?: string;
  location?: string;
  ratings: { rapid?: number; blitz?: number };
}
/** Chess.com's accounts, by current username. */
const remote = new Map<string, RemoteAccount>();

before(async () => {
  if (skip) return;
  // config.ts reads these at import time, so set them before loading the app.
  process.env.DATABASE_URL = url;
  process.env.AUTH_SECRET = SECRET;
  delete process.env.REDIS_URL;

  const express = (await import('express')).default;
  const jwt = (await import('jsonwebtoken')).default;
  const { prisma } = await import('../../services/db.service');
  const { ChessComClient } = await import('../../services/chess.service');
  const { MemberService } = await import('../../services/member.service');
  const { createAuthRouter } = await import('../../routes/auth.routes');
  const { errorHandler } = await import('../../middleware/error.middleware');
  db = prisma;

  class FakeChessCom extends ChessComClient {
    override async getProfile(username: string) {
      const name = username.toLowerCase();
      const entry = remote.get(name);
      if (!entry) return null;
      return {
        username: name,
        ...(entry.playerId ? { player_id: entry.playerId } : {}),
        ...(entry.status ? { status: entry.status } : {}),
        ...(entry.location ? { location: entry.location } : {}),
      };
    }
    override async getStats(username: string) {
      const entry = remote.get(username.toLowerCase());
      if (!entry) return null;
      return {
        ...(entry.ratings.rapid ? { chess_rapid: { last: { rating: entry.ratings.rapid } } } : {}),
        ...(entry.ratings.blitz ? { chess_blitz: { last: { rating: entry.ratings.blitz } } } : {}),
      };
    }
  }

  token = (sub, { email = `${sub.split(':')[1]}@iitr.ac.in`, verified = true } = {}) =>
    jwt.sign({ sub, email, email_verified: verified }, SECRET, { algorithm: 'HS256', expiresIn: '5m' });

  const app = express();
  app.use(express.json());
  app.use(
    '/api/auth',
    createAuthRouter({
      db: prisma,
      members: new MemberService(prisma, 'iitr.ac.in'),
      chess: new FakeChessCom('test'),
      io: { emit: () => true } as never,
      authSecret: SECRET,
    })
  );
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await cleanup();
  remote.set('auth-owner', { ratings: { rapid: 1500, blitz: 1400 } });
  remote.set('auth-other', { ratings: { rapid: 1300 } });
});

async function cleanup() {
  await db.tournament.deleteMany({ where: { name: { startsWith: 'auth-' } } });
  // Deleting a member deletes their identities too.
  await db.user.deleteMany({ where: { identities: { some: { authId: { startsWith: 'test', contains: ':auth-' } } } } });
  await db.chessProfile.deleteMany({ where: { id: { startsWith: 'auth-' } } });
}

after(async () => {
  if (skip) return;
  await cleanup();
  server.close();
  await db.$disconnect();
});

async function call(method: string, path: string, jwtToken?: string, body?: unknown) {
  const res = await fetch(`${base}/api/auth${path}`, {
    method,
    headers: {
      ...(jwtToken ? { Authorization: `Bearer ${jwtToken}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as { success: boolean; data?: any; error?: string } };
}

/** The full linking flow: get a code, put it on the Chess.com profile, verify. */
async function link(jwtToken: string, username: string) {
  const challenge = await call('POST', '/link-profile/challenge', jwtToken, { chessUsername: username });
  assert.equal(challenge.status, 200, challenge.body.error ?? 'challenge failed');
  remote.get(username)!.location = challenge.body.data.code;
  return call('POST', '/link-profile', jwtToken, { chessUsername: username });
}

test('linking requires a verified institute email', { skip }, async () => {
  const outsider = await call('POST', '/link-profile/challenge', token('test:auth-outsider', { email: 'x@gmail.com' }), { chessUsername: 'auth-owner' });
  assert.equal(outsider.status, 403);
  const lookalike = await call('POST', '/link-profile/challenge', token('test:auth-lookalike', { email: 'x@notiitr.ac.in' }), { chessUsername: 'auth-owner' });
  assert.equal(lookalike.status, 403);
  const unverified = await call('POST', '/link-profile/challenge', token('test:auth-unverified', { verified: false }), { chessUsername: 'auth-owner' });
  assert.equal(unverified.status, 403);
  assert.match(unverified.body.error!, /hasn't confirmed/);
  const department = await call('POST', '/link-profile/challenge', token('test:auth-dept', { email: 'dept@ece.iitr.ac.in' }), { chessUsername: 'auth-owner' });
  assert.equal(department.status, 200, 'department addresses are institute addresses');
});

test('linking requires the code on the Chess.com profile, then creates the player', { skip }, async () => {
  const me = token('test:auth-alice');
  const challenge = await call('POST', '/link-profile/challenge', me, { chessUsername: 'AUTH-Owner' });
  assert.equal(challenge.status, 200);
  const code = challenge.body.data.code as string;

  const missing = await call('POST', '/link-profile/challenge', me, { chessUsername: 'auth-ghost' });
  assert.equal(missing.status, 404);

  const early = await call('POST', '/link-profile', me, { chessUsername: 'auth-owner' });
  assert.equal(early.status, 400, 'no code on the profile yet');

  remote.get('auth-owner')!.location = `Roorkee ${code}`;
  const linked = await call('POST', '/link-profile', me, { chessUsername: 'auth-owner' });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.data.chessProfileId, 'auth-owner');
  const profile = await db.chessProfile.findUniqueOrThrow({ where: { id: 'auth-owner' } });
  assert.equal(profile.rapidRating, 1500);

  // Someone else can't take it, even with their own valid code on the profile.
  const bob = token('test:auth-bob');
  const bobChallenge = await call('POST', '/link-profile/challenge', bob, { chessUsername: 'auth-owner' });
  assert.equal(bobChallenge.status, 409);
});

test('members can refresh only their own account, once a minute; admins can refresh anyone', { skip }, async () => {
  const alice = token('test:auth-alice'); // linked to auth-owner by the previous test
  assert.equal((await call('POST', '/sync/auth-other', alice)).status, 403);
  assert.equal((await call('POST', '/sync/auth-owner', alice)).status, 200);
  assert.equal((await call('POST', '/sync/auth-owner', alice)).status, 429);

  // Admin status is set on the member after their first sign-in, as in Prisma Studio.
  const admin = token('test:auth-admin');
  await call('GET', '/me', admin);
  await db.user.updateMany({ where: { identities: { some: { authId: 'test:auth-admin' } } }, data: { role: 'ADMIN' } });
  const added = await call('POST', '/sync/auth-other', admin);
  assert.equal(added.status, 200, 'admins add new players this way');
  assert.equal(added.body.data.rapidRating, 1300);
  assert.equal((await call('POST', '/sync/auth-ghost', admin)).status, 404);
});

test('a member can claim a player an admin already added; the row and its history are kept', { skip }, async () => {
  // auth-other was added by the admin in the previous test, with no member attached.
  const historyBefore = await db.ratingHistory.count({ where: { profileId: 'auth-other' } });
  assert.ok(historyBefore > 0);

  const linked = await link(token('test:auth-dave', { email: 'dave@ece.iitr.ac.in' }), 'auth-other');
  assert.equal(linked.status, 200);
  assert.equal(linked.body.data.chessProfileId, 'auth-other');
  assert.equal(await db.chessProfile.count({ where: { id: 'auth-other' } }), 1, 'no duplicate player');
  assert.ok((await db.ratingHistory.count({ where: { profileId: 'auth-other' } })) >= historyBefore);
});

test('every sign-in with the same verified institute email is the same member', { skip }, async () => {
  remote.set('auth-erin', { ratings: { rapid: 1600 } });
  const email = 'erin@ece.iitr.ac.in';
  assert.equal((await link(token('test:auth-erin', { email }), 'auth-erin')).status, 200);
  await db.user.updateMany({ where: { instituteEmail: email }, data: { role: 'ADMIN' } });

  // The first GitHub sign-in finds the same member: same link, same role.
  const viaGithub = await call('GET', '/me', token('test-gh:auth-erin', { email }));
  assert.equal(viaGithub.status, 200);
  assert.equal(viaGithub.body.data.chessProfileId, 'auth-erin');
  assert.equal(viaGithub.body.data.role, 'ADMIN');
  assert.deepEqual(viaGithub.body.data.identities.map((i: { provider: string }) => i.provider), ['test', 'test-gh']);
  assert.equal(await db.user.count({ where: { instituteEmail: email } }), 1);
});

test('sign-ins without a verified institute email are never merged into a member', { skip }, async () => {
  const unverified = await call('GET', '/me', token('test-gh:auth-erin-unverified', { email: 'erin@ece.iitr.ac.in', verified: false }));
  assert.equal(unverified.body.data.chessProfileId, null);
  assert.equal(unverified.body.data.role, 'USER');

  const personal = await call('GET', '/me', token('test-gh:auth-erin-personal', { email: 'erin@gmail.com' }));
  assert.equal(personal.body.data.chessProfileId, null);
  assert.notEqual(personal.body.data.id, unverified.body.data.id);
});

test('first sign-ins racing each other still make one member', { skip }, async () => {
  const email = 'frank@iitr.ac.in';
  const signIns = ['test:auth-frank', 'test-gh:auth-frank', 'test-dc:auth-frank'].map((sub) => token(sub, { email }));
  // Every provider at once, twice each, as if the same person opened several tabs.
  const responses = await Promise.all(signIns.flatMap((t) => [call('GET', '/me', t), call('GET', '/me', t)]));

  assert.deepEqual(responses.map((r) => r.status), [200, 200, 200, 200, 200, 200]);
  assert.equal(new Set(responses.map((r) => r.body.data.id)).size, 1);
  assert.equal(await db.user.count({ where: { instituteEmail: email } }), 1);
  assert.equal(await db.identity.count({ where: { authId: { endsWith: ':auth-frank' } } }), 3);
});

test('a renamed Chess.com account keeps its history, games and member link', { skip }, async () => {
  remote.set('auth-old', { playerId: 4242, ratings: { rapid: 1450 } });
  const gina = token('test:auth-gina');
  assert.equal((await link(gina, 'auth-old')).status, 200);
  const history = await db.ratingHistory.count({ where: { profileId: 'auth-old' } });
  const tournament = await db.tournament.create({ data: { name: 'auth-rename', participants: { create: { profileId: 'auth-old' } } } });

  // Renamed on Chess.com: the old name stops resolving, the new one has the same player_id.
  remote.delete('auth-old');
  remote.set('auth-new', { playerId: 4242, ratings: { rapid: 1460 } });
  const relinked = await link(gina, 'auth-new');
  assert.equal(relinked.status, 200);
  assert.equal(relinked.body.data.chessProfileId, 'auth-new');

  assert.equal(await db.chessProfile.count({ where: { id: 'auth-old' } }), 0, 'the row moved instead of being copied');
  assert.ok((await db.ratingHistory.count({ where: { profileId: 'auth-new' } })) >= history);
  const entry = await db.tournamentParticipant.findFirstOrThrow({ where: { tournamentId: tournament.id } });
  assert.equal(entry.profileId, 'auth-new');
});

test("a closed Chess.com account can't be linked", { skip }, async () => {
  remote.set('auth-closed', { status: 'closed', ratings: { rapid: 1200 } });
  const closed = await call('POST', '/link-profile/challenge', token('test:auth-henry'), { chessUsername: 'auth-closed' });
  assert.equal(closed.status, 400);
  assert.match(closed.body.error!, /closed/);
});

test('/me creates the member once, even under parallel first requests', { skip }, async () => {
  const fresh = token('test:auth-carol');
  const responses = await Promise.all([call('GET', '/me', fresh), call('GET', '/me', fresh), call('GET', '/me', fresh)]);
  assert.deepEqual(responses.map((r) => r.status), [200, 200, 200]);
  assert.equal(await db.identity.count({ where: { authId: 'test:auth-carol' } }), 1);
  assert.equal(await db.user.count({ where: { identities: { some: { authId: 'test:auth-carol' } } } }), 1);
  assert.equal(responses[0]!.body.data.identities[0].provider, 'test');
});

test('rejects missing, forged and malformed tokens', { skip }, async () => {
  assert.equal((await call('GET', '/me')).status, 401);
  assert.equal((await call('GET', '/me', 'not-a-jwt')).status, 401);
  // An unsigned token ("alg": "none") must not be accepted.
  const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"test:auth-x"}').toString('base64url')}.`;
  assert.equal((await call('GET', '/me', unsigned)).status, 401);
});
