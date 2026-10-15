/**
 * Who may change a tournament, through the real HTTP routes and auth middleware.
 *
 *   TEST_DATABASE_URL=postgres://…localhost… npm run test:integration
 *
 * Rows use the "rt-" prefix (sign-ins "test:rt-…") and are deleted afterwards.
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
let token: (sub: string) => string;
let tournamentId = '';

before(async () => {
  if (skip) return;
  // config.ts reads these at import time, so set them before loading the app.
  process.env.DATABASE_URL = url;
  process.env.AUTH_SECRET = SECRET;
  delete process.env.REDIS_URL;

  const express = (await import('express')).default;
  const jwt = (await import('jsonwebtoken')).default;
  const { prisma } = await import('../../services/db.service');
  const { MemberService } = await import('../../services/member.service');
  const { TournamentService } = await import('../../services/tournament.service');
  const { SwissPairing } = await import('../../domain/pairing/swiss');
  const { createTournamentRouter } = await import('../../routes/tournament.routes');
  const { errorHandler, notFoundHandler } = await import('../../middleware/error.middleware');
  db = prisma;

  token = (sub) => jwt.sign({ sub, email: `${sub.split(':')[1]}@iitr.ac.in`, email_verified: true }, SECRET, { algorithm: 'HS256', expiresIn: '5m' });

  const app = express();
  app.use(express.json());
  app.use(
    '/api/tournaments',
    createTournamentRouter({ members: new MemberService(prisma, 'iitr.ac.in'), tournaments: new TournamentService(prisma, new SwissPairing()) })
  );
  app.use(notFoundHandler);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await cleanup();
  await db.chessProfile.createMany({
    data: [
      { id: 'rt-anna', username: 'rt-anna', rapidRating: 1700 },
      { id: 'rt-ben', username: 'rt-ben', rapidRating: 1600 },
    ],
  });
  // A member, and an admin as Prisma Studio would make one.
  await db.user.create({ data: { identities: { create: { authId: 'test:rt-member', provider: 'test' } } } });
  await db.user.create({ data: { role: 'ADMIN', identities: { create: { authId: 'test:rt-admin', provider: 'test' } } } });
  tournamentId = (await db.tournament.create({ data: { name: 'rt-open' } })).id;
});

async function cleanup() {
  await db.tournament.deleteMany({ where: { name: { startsWith: 'rt-' } } });
  await db.user.deleteMany({ where: { identities: { some: { authId: { startsWith: 'test:rt-' } } } } });
  await db.chessProfile.deleteMany({ where: { id: { startsWith: 'rt-' } } });
}

after(async () => {
  if (skip) return;
  await cleanup();
  server.close();
  await db.$disconnect();
});

async function call(method: string, path: string, sub?: string, body?: unknown) {
  const res = await fetch(`${base}/api/tournaments${path}`, {
    method,
    headers: {
      ...(sub ? { Authorization: `Bearer ${token(sub)}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as { success: boolean; data?: any; error?: string } };
}

test('only admins can add or remove players; nobody can enter themselves', { skip }, async () => {
  const add = (sub?: string) => call('POST', `/${tournamentId}/players`, sub, { username: 'rt-anna' });
  assert.equal((await add()).status, 401);
  assert.equal((await add('test:rt-member')).status, 403);
  assert.equal((await add('test:rt-stranger')).status, 403, 'a sign-in the API has never seen');
  assert.equal((await call('POST', `/${tournamentId}/join`, 'test:rt-member')).status, 404, 'self-registration is gone');

  const added = await add('test:rt-admin');
  assert.equal(added.status, 201);
  assert.equal(added.body.data.profileId, 'rt-anna');
  assert.equal(added.body.data.seedRating, 1700);
  assert.equal((await add('test:rt-admin')).status, 409);
  assert.equal((await call('POST', `/${tournamentId}/players`, 'test:rt-admin', { username: 'not valid!' })).status, 400);

  assert.equal((await call('DELETE', `/${tournamentId}/players/rt-anna`, 'test:rt-member')).status, 403);
  assert.equal((await call('DELETE', `/${tournamentId}/players/rt-anna`, 'test:rt-admin')).status, 200);
  assert.equal((await call('DELETE', `/${tournamentId}/players/rt-anna`, 'test:rt-admin')).status, 404);
});

test('only admins can correct results', { skip }, async () => {
  await call('POST', `/${tournamentId}/players`, 'test:rt-admin', { username: 'rt-anna' });
  await call('POST', `/${tournamentId}/players`, 'test:rt-admin', { username: 'rt-ben' });
  assert.equal((await call('POST', `/${tournamentId}/generate-round`, 'test:rt-admin')).status, 200);
  const game = await db.match.findFirstOrThrow({ where: { tournamentId } });
  const path = `/${tournamentId}/matches/${game.id}/result`;

  assert.equal((await call('POST', path, 'test:rt-admin', { result: 'white' })).status, 200);
  assert.equal((await call('PUT', path, 'test:rt-member', { result: 'black' })).status, 403);
  assert.equal((await call('PUT', path, 'test:rt-admin', { result: 'black' })).status, 200);
  const detail = await call('GET', `/${tournamentId}`);
  assert.equal(detail.body.data.participants[0].profileId, game.player2Id, 'Black now leads');
});
