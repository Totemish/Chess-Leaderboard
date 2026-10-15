/**
 * Players leaving and rejoining the leaderboard, against a real database with
 * a fake Chess.com: closed accounts, accounts Chess.com can't find, renamed
 * accounts, and players an admin removed.
 *
 *   TEST_DATABASE_URL=postgres://…localhost… npm run test:integration
 *
 * Every player it creates uses the "pl-" prefix and is deleted afterwards.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'set TEST_DATABASE_URL to run integration tests';
if (url && !/@(localhost|127\.0\.0\.1)[:/]/.test(url) && process.env.TEST_DATABASE_ALLOW_REMOTE !== 'true') {
  throw new Error('TEST_DATABASE_URL must point at a local, disposable database');
}

type ChessService = typeof import('../../services/chess.service');
let db: import('@prisma/client').PrismaClient;
let chess: ChessService;
let fake: InstanceType<ChessService['ChessComClient']>;
let onLeaderboard: (id: string) => Promise<boolean>;
let GRACE_MS = 0;

/** Chess.com's accounts by current username, and old names that now answer for a new one. */
const remote = new Map<string, { playerId?: number; status?: string; rapid: number }>();
const renamedTo = new Map<string, string>();

before(async () => {
  if (skip) return;
  // config.ts reads these at import time, so set them before loading the services.
  process.env.DATABASE_URL = url;
  process.env.AUTH_SECRET = 'integration-test-secret';
  delete process.env.REDIS_URL;

  db = (await import('../../services/db.service')).prisma;
  chess = await import('../../services/chess.service');
  const { getLeaderboard } = await import('../../services/redis.service');
  GRACE_MS = (await import('../../domain/player-status')).MISSING_GRACE_MS;

  class FakeChessCom extends chess.ChessComClient {
    override async getProfile(username: string) {
      const name = renamedTo.get(username.toLowerCase()) ?? username.toLowerCase();
      const entry = remote.get(name);
      if (!entry) return null;
      return { username: name, ...(entry.playerId ? { player_id: entry.playerId } : {}), ...(entry.status ? { status: entry.status } : {}) };
    }
    override async getStats(username: string) {
      const entry = remote.get(username.toLowerCase());
      return entry ? { chess_rapid: { last: { rating: entry.rapid } } } : null;
    }
  }
  fake = new FakeChessCom('test');
  onLeaderboard = async (id) => (await getLeaderboard('rapid')).some((p) => p.id === id);
  await cleanup();
});

async function cleanup() {
  await db.chessProfile.deleteMany({ where: { id: { startsWith: 'pl-' } } });
}

after(async () => {
  if (skip) return;
  await cleanup();
  await db.$disconnect();
});

test('a closed account leaves the leaderboard, keeps its history, and returns if reopened', { skip }, async () => {
  remote.set('pl-closer', { rapid: 1500 });
  await chess.syncPlayer(fake, 'pl-closer');
  assert.ok(await onLeaderboard('pl-closer'));

  remote.get('pl-closer')!.status = 'closed:fair_play_violations';
  const closed = await chess.syncPlayer(fake, 'pl-closer');
  assert.equal(closed!.profile.status, 'CLOSED_FAIR_PLAY');
  assert.equal(closed!.relisted, true, 'open pages refetch the board');
  assert.equal(await onLeaderboard('pl-closer'), false);
  assert.ok((await db.ratingHistory.count({ where: { profileId: 'pl-closer' } })) > 0, 'history is kept');

  remote.get('pl-closer')!.status = 'basic';
  const reopened = await chess.syncPlayer(fake, 'pl-closer');
  assert.equal(reopened!.profile.status, 'ACTIVE');
  assert.ok(await onLeaderboard('pl-closer'));
});

test("an account Chess.com can't find is hidden only after a day of misses", { skip }, async () => {
  remote.set('pl-gone', { rapid: 1400 });
  await chess.syncPlayer(fake, 'pl-gone');
  remote.delete('pl-gone');

  assert.equal(await chess.syncPlayer(fake, 'pl-gone'), null);
  const firstMiss = await chess.recordMissing('pl-gone');
  assert.equal(firstMiss!.profile.status, 'ACTIVE');
  assert.ok(firstMiss!.profile.missingSince);
  assert.ok(await onLeaderboard('pl-gone'), 'one miss is not enough');

  const dayLater = await chess.recordMissing('pl-gone', new Date(Date.now() + GRACE_MS));
  assert.equal(dayLater!.profile.status, 'MISSING');
  assert.equal(dayLater!.relisted, true);
  assert.equal(await onLeaderboard('pl-gone'), false);

  remote.set('pl-gone', { rapid: 1410 });
  const back = await chess.syncPlayer(fake, 'pl-gone');
  assert.equal(back!.profile.status, 'ACTIVE');
  assert.equal(back!.profile.missingSince, null);
  assert.equal(await chess.recordMissing('pl-never-tracked'), null);
});

test("an admin's removal survives syncs; adding the player again brings them back", { skip }, async () => {
  remote.set('pl-removed', { rapid: 1300 });
  await chess.syncPlayer(fake, 'pl-removed');
  await db.chessProfile.update({ where: { id: 'pl-removed' }, data: { status: 'REMOVED' } });

  assert.equal((await chess.syncPlayer(fake, 'pl-removed'))!.profile.status, 'REMOVED');
  assert.equal(await onLeaderboard('pl-removed'), false);
  assert.equal((await chess.syncPlayer(fake, 'pl-removed', { restore: true }))!.profile.status, 'ACTIVE');
  assert.ok(await onLeaderboard('pl-removed'));
});

test('a rename spotted by the sync moves the row to the new username', { skip }, async () => {
  remote.set('pl-oldname', { playerId: 9001, rapid: 1200 });
  await chess.syncPlayer(fake, 'pl-oldname');

  // Renamed on Chess.com, and the old name now answers with the new profile.
  remote.delete('pl-oldname');
  remote.set('pl-newname', { playerId: 9001, rapid: 1210 });
  renamedTo.set('pl-oldname', 'pl-newname');

  const synced = await chess.syncPlayer(fake, 'pl-oldname');
  assert.equal(synced!.profile.id, 'pl-newname');
  assert.equal(synced!.relisted, true);
  assert.equal(await db.chessProfile.count({ where: { id: 'pl-oldname' } }), 0);
  assert.equal(await db.ratingHistory.count({ where: { profileId: 'pl-newname' } }), 1, "today's row moved and was updated");
});
