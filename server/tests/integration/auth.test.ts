/**
 * The auth routes' security rules, against a real database with a fake
 * Chess.com (a subclass of the real client, so the routes can't tell).
 *
 *   TEST_DATABASE_URL=postgres://…localhost… npm run test:integration
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
const remote = new Map<string, { location?: string; ratings: { rapid?: number; blitz?: number } }>();

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
  const { createAuthRouter } = await import('../../routes/auth.routes');
  const { errorHandler } = await import('../../middleware/error.middleware');
  db = prisma;

  class FakeChessCom extends ChessComClient {
    override async getProfile(username: string) {
      const entry = remote.get(username.toLowerCase());
      return entry ? { username: username.toLowerCase(), ...(entry.location ? { location: entry.location } : {}) } : null;
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
      chess: new FakeChessCom('test'),
      io: { emit: () => true } as never,
      authSecret: SECRET,
      instituteDomain: '@iitr.ac.in',
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
  await db.user.deleteMany({ where: { authId: { startsWith: 'test:auth-' } } });
  await db.chessProfile.deleteMany({ where: { id: { in: ['auth-owner', 'auth-other'] } } });
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

test('linking requires a verified institute email', { skip }, async () => {
  const outsider = await call('POST', '/link-profile/challenge', token('test:auth-outsider', { email: 'x@gmail.com' }), { chessUsername: 'auth-owner' });
  assert.equal(outsider.status, 403);
  const unverified = await call('POST', '/link-profile/challenge', token('test:auth-unverified', { verified: false }), { chessUsername: 'auth-owner' });
  assert.equal(unverified.status, 403);
  assert.match(unverified.body.error!, /hasn't confirmed/);
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

  await db.user.upsert({
    where: { authId: 'test:auth-admin' },
    update: { role: 'ADMIN' },
    create: { authId: 'test:auth-admin', role: 'ADMIN' },
  });
  const admin = token('test:auth-admin');
  const added = await call('POST', '/sync/auth-other', admin);
  assert.equal(added.status, 200, 'admins add new players this way');
  assert.equal(added.body.data.rapidRating, 1300);
  assert.equal((await call('POST', '/sync/auth-ghost', admin)).status, 404);
});

test('/me creates the member once, even under parallel first requests', { skip }, async () => {
  const fresh = token('test:auth-carol');
  const responses = await Promise.all([call('GET', '/me', fresh), call('GET', '/me', fresh), call('GET', '/me', fresh)]);
  assert.deepEqual(responses.map((r) => r.status), [200, 200, 200]);
  assert.equal(await db.user.count({ where: { authId: 'test:auth-carol' } }), 1);
  assert.equal(responses[0]!.body.data.provider, 'test');
});

test('rejects missing, forged and malformed tokens', { skip }, async () => {
  assert.equal((await call('GET', '/me')).status, 401);
  assert.equal((await call('GET', '/me', 'not-a-jwt')).status, 401);
  // An unsigned token ("alg": "none") must not be accepted.
  const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"test:auth-x"}').toString('base64url')}.`;
  assert.equal((await call('GET', '/me', unsigned)).status, 401);
});
