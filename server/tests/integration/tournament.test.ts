/**
 * TournamentService against a real Postgres database.
 *
 *   TEST_DATABASE_URL=postgres://…localhost… npm run test:integration
 *
 * Point it at a disposable database (e.g. `npx prisma dev`) with migrations
 * applied. It refuses non-local hosts so it can never touch production. Every
 * row it creates uses the "it-" prefix and is deleted afterwards.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { TournamentService } from '../../services/tournament.service';
import { SwissPairing } from '../../domain/pairing/swiss';
import { computeStandings } from '../../domain/standings';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors';

const url = process.env.TEST_DATABASE_URL;
const isLocal = !!url && /@(localhost|127\.0\.0\.1)[:/]/.test(url);
if (url && !isLocal && process.env.TEST_DATABASE_ALLOW_REMOTE !== 'true') {
  throw new Error('TEST_DATABASE_URL must point at a local, disposable database');
}

const skip = url ? false : 'set TEST_DATABASE_URL to run integration tests';
const db = url ? new PrismaClient({ datasourceUrl: url }) : (null as unknown as PrismaClient);
const service = url ? new TournamentService(db, new SwissPairing()) : (null as unknown as TournamentService);

const PLAYERS = [
  { id: 'it-alpha', rapid: 2100, blitz: 1500 },
  { id: 'it-bravo', rapid: 1900, blitz: 2000 },
  { id: 'it-charlie', rapid: 1800, blitz: 1800 },
  { id: 'it-delta', rapid: 1700, blitz: 1700 },
  { id: 'it-echo', rapid: 1600, blitz: null },
];
const authId = (profileId: string) => `test:${profileId}`;

async function cleanup() {
  await db.tournament.deleteMany({ where: { name: { startsWith: 'it-' } } });
  await db.user.deleteMany({ where: { authId: { startsWith: 'test:it-' } } });
  await db.chessProfile.deleteMany({ where: { id: { startsWith: 'it-' } } });
}

async function newTournament(name: string, format: 'rapid' | 'blitz' = 'rapid', players = PLAYERS) {
  const t = await service.create(`it-${name}`, format);
  for (const p of players) await service.join(t.id, authId(p.id));
  return t;
}

/** Records every pending result in the tournament's current round: the first player listed wins. */
async function finishRound(tournamentId: string) {
  const pending = await db.match.findMany({ where: { tournamentId, status: 'PENDING' } });
  for (const m of pending) await service.recordResult(tournamentId, m.id, 'white');
}

before(async () => {
  if (skip) return;
  await cleanup();
  for (const p of PLAYERS) {
    await db.chessProfile.create({ data: { id: p.id, username: p.id, displayName: p.id, rapidRating: p.rapid, blitzRating: p.blitz } });
    await db.user.create({ data: { authId: authId(p.id), chessProfileId: p.id } });
  }
});

after(async () => {
  if (skip) return;
  await cleanup();
  await db.$disconnect();
});

test('full lifecycle: register, pair, record, finish', { skip }, async () => {
  const t = await newTournament('lifecycle', 'blitz');

  // Seeds use the tournament's time control; a missing rating seeds at 0.
  const seeds = Object.fromEntries((await db.tournamentParticipant.findMany({ where: { tournamentId: t.id } })).map((p) => [p.profileId, p.seedRating]));
  assert.equal(seeds['it-bravo'], 2000);
  assert.equal(seeds['it-echo'], 0);

  await assert.rejects(service.join(t.id, authId('it-alpha')), ConflictError);
  await assert.rejects(service.join(t.id, 'test:it-nobody'), BadRequestError);

  const r1 = await service.pairNextRound(t.id);
  assert.deepEqual(r1, { round: 1, boards: 3 }); // 5 players: two games and a bye
  await assert.rejects(service.join(t.id, authId('it-alpha')), ConflictError); // registration closed
  await assert.rejects(service.pairNextRound(t.id), ConflictError); // round 1 unfinished

  const bye = await db.match.findFirstOrThrow({ where: { tournamentId: t.id, player2Id: null } });
  await assert.rejects(service.recordResult(t.id, bye.id, 'white'), BadRequestError);
  await assert.rejects(service.recordResult(t.id, 'not-a-match', 'white'), NotFoundError);
  await assert.rejects(service.finish(t.id), ConflictError); // results missing

  const game = await db.match.findFirstOrThrow({ where: { tournamentId: t.id, status: 'PENDING' } });
  await service.recordResult(t.id, game.id, 'draw');
  await assert.rejects(service.recordResult(t.id, game.id, 'white'), ConflictError); // can't score twice
  await finishRound(t.id);

  assert.deepEqual(await service.pairNextRound(t.id), { round: 2, boards: 3 });
  const round2 = await db.match.findMany({ where: { tournamentId: t.id, round: 2 } });
  const byeR2 = round2.find((m) => m.player2Id === null)!;
  assert.notEqual(byeR2.player1Id, bye.player1Id, 'nobody gets a second bye while others have none');
  await finishRound(t.id);

  const done = await service.finish(t.id);
  assert.equal(done.status, 'COMPLETED');
  await assert.rejects(service.pairNextRound(t.id), ConflictError);

  // Stored standings equal a fresh computation from the games.
  const [participants, matches] = [
    await db.tournamentParticipant.findMany({ where: { tournamentId: t.id } }),
    await db.match.findMany({ where: { tournamentId: t.id } }),
  ];
  const expected = computeStandings(
    participants.map((p) => p.profileId),
    matches.map((m) => ({ whiteId: m.player1Id, blackId: m.player2Id, winnerId: m.winnerId, isDraw: m.isDraw, completed: m.status === 'COMPLETED' }))
  );
  for (const p of participants) {
    assert.deepEqual({ score: p.score, buchholz: p.buchholz }, expected.get(p.profileId), p.profileId);
  }
  assert.equal(participants.reduce((sum, p) => sum + p.score, 0), 6); // 4 games + 2 byes
});

test('the same result submitted twice at once is counted once', { skip }, async () => {
  const t = await newTournament('double-submit');
  await service.pairNextRound(t.id);
  const game = await db.match.findFirstOrThrow({ where: { tournamentId: t.id, status: 'PENDING' } });

  const outcomes = await Promise.allSettled([
    service.recordResult(t.id, game.id, 'white'),
    service.recordResult(t.id, game.id, 'white'),
  ]);
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof ConflictError);

  const winner = await db.tournamentParticipant.findFirstOrThrow({ where: { tournamentId: t.id, profileId: game.player1Id! } });
  assert.equal(winner.score, 1);
});

test('two admins pressing "Pair" at once create one round', { skip }, async () => {
  const t = await newTournament('double-pair');
  const outcomes = await Promise.allSettled([service.pairNextRound(t.id), service.pairNextRound(t.id)]);
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  assert.equal(await db.match.count({ where: { tournamentId: t.id } }), 3);
  assert.equal((await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).currentRound, 1);
});

test('deleting a tournament removes its registrations and games, but not the players', { skip }, async () => {
  const t = await newTournament('delete-me');
  await service.pairNextRound(t.id);
  await service.remove(t.id);

  assert.equal(await db.tournament.count({ where: { id: t.id } }), 0);
  assert.equal(await db.tournamentParticipant.count({ where: { tournamentId: t.id } }), 0);
  assert.equal(await db.match.count({ where: { tournamentId: t.id } }), 0);
  assert.equal(await db.chessProfile.count({ where: { id: { in: PLAYERS.map((p) => p.id) } } }), PLAYERS.length);
  await assert.rejects(service.remove(t.id), NotFoundError);
});

test('results for different games entered at once are both kept in the standings', { skip }, async () => {
  const t = await newTournament('parallel-results');
  await service.pairNextRound(t.id);
  const games = await db.match.findMany({ where: { tournamentId: t.id, status: 'PENDING' } });
  assert.equal(games.length, 2);

  await Promise.all(games.map((g) => service.recordResult(t.id, g.id, 'black')));

  const scores = await db.tournamentParticipant.findMany({ where: { tournamentId: t.id } });
  const total = scores.reduce((sum, p) => sum + p.score, 0);
  assert.equal(total, 3, 'two wins and a bye: no lost update between the two transactions');
});
