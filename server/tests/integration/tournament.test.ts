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
import { seededRandom } from '../helpers';

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
/** A bigger field for the simulated event: nine players, so someone gets a bye every round. */
const FIELD = Array.from({ length: 9 }, (_, i) => ({ id: `it-sim-${i + 1}`, rapid: 2000 - i * 40, blitz: null }));

async function cleanup() {
  await db.tournament.deleteMany({ where: { name: { startsWith: 'it-' } } });
  await db.chessProfile.deleteMany({ where: { id: { startsWith: 'it-' } } });
}

async function newTournament(name: string, format: 'rapid' | 'blitz' = 'rapid', players = PLAYERS) {
  const t = await service.create(`it-${name}`, format);
  for (const p of players) await service.addPlayer(t.id, p.id);
  return t;
}

/** Records every pending result in the tournament's current round: the first player listed wins. */
async function finishRound(tournamentId: string) {
  const pending = await db.match.findMany({ where: { tournamentId, status: 'PENDING' } });
  for (const m of pending) await service.recordResult(tournamentId, m.id, 'white');
}

const scoreOf = async (tournamentId: string, profileId: string) =>
  (await db.tournamentParticipant.findFirstOrThrow({ where: { tournamentId, profileId } })).score;

before(async () => {
  if (skip) return;
  await cleanup();
  for (const p of [...PLAYERS, ...FIELD]) {
    await db.chessProfile.create({ data: { id: p.id, username: p.id, displayName: p.id, rapidRating: p.rapid, blitzRating: p.blitz } });
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

  const r1 = await service.pairNextRound(t.id);
  assert.deepEqual(r1, { round: 1, boards: 3 }); // 5 players: two games and a bye
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

test('admins add and remove players until round 1 is paired', { skip }, async () => {
  const t = await service.create('it-roster', 'blitz');
  const entry = await service.addPlayer(t.id, 'it-bravo');
  assert.equal(entry.seedRating, 2000, 'seeded by the tournament time control');
  await assert.rejects(service.addPlayer(t.id, 'it-bravo'), ConflictError);
  await assert.rejects(service.addPlayer(t.id, 'it-nobody'), NotFoundError);
  await assert.rejects(service.addPlayer('no-such-tournament', 'it-alpha'), NotFoundError);

  await service.addPlayer(t.id, 'it-alpha');
  await service.removePlayer(t.id, 'it-alpha');
  await assert.rejects(service.removePlayer(t.id, 'it-alpha'), NotFoundError);
  await service.addPlayer(t.id, 'it-charlie');

  await service.pairNextRound(t.id);
  await assert.rejects(service.addPlayer(t.id, 'it-delta'), ConflictError, 'the list locks at round 1');
  await assert.rejects(service.removePlayer(t.id, 'it-bravo'), ConflictError);
  assert.equal(await db.tournamentParticipant.count({ where: { tournamentId: t.id } }), 2);
});

test("a player who has left the leaderboard can't be added", { skip }, async () => {
  const t = await service.create('it-closed-account', 'rapid');
  await db.chessProfile.update({ where: { id: 'it-echo' }, data: { status: 'CLOSED' } });
  try {
    await assert.rejects(service.addPlayer(t.id, 'it-echo'), BadRequestError);
    await service.addPlayer(t.id, 'it-delta');
  } finally {
    await db.chessProfile.update({ where: { id: 'it-echo' }, data: { status: 'ACTIVE' } });
  }
});

test('a mistaken result in the latest round can be corrected, and the standings follow', { skip }, async () => {
  const t = await newTournament('correction');
  await service.pairNextRound(t.id);
  const [game, other] = await db.match.findMany({ where: { tournamentId: t.id, status: 'PENDING' }, orderBy: { id: 'asc' } });

  await service.recordResult(t.id, game!.id, 'white');
  await service.changeResult(t.id, game!.id, 'black');
  assert.equal(await scoreOf(t.id, game!.player1Id!), 0);
  assert.equal(await scoreOf(t.id, game!.player2Id!), 1);
  await service.changeResult(t.id, game!.id, 'draw');
  assert.equal(await scoreOf(t.id, game!.player1Id!), 0.5);

  const bye = await db.match.findFirstOrThrow({ where: { tournamentId: t.id, player2Id: null } });
  await assert.rejects(service.changeResult(t.id, bye.id, 'white'), BadRequestError);
  await assert.rejects(service.changeResult(t.id, other!.id, 'white'), ConflictError, 'no result to change yet');

  // Once round 2 is paired from round 1's results, those results are fixed.
  await finishRound(t.id);
  await service.pairNextRound(t.id);
  await assert.rejects(service.changeResult(t.id, game!.id, 'white'), ConflictError);
});

test('a simulated 9-player, 5-round Swiss keeps every pairing and standings rule', { skip }, async () => {
  const t = await newTournament('simulation', 'rapid', FIELD);
  const random = seededRandom(2026);

  for (let round = 1; round <= 5; round++) {
    await service.pairNextRound(t.id);
    const games = await db.match.findMany({ where: { tournamentId: t.id, round } });
    const seated = games.flatMap((g) => [g.player1Id, g.player2Id]).filter((id) => id !== null);
    assert.equal(seated.length, FIELD.length, `round ${round}: everyone is paired`);
    assert.equal(new Set(seated).size, FIELD.length, `round ${round}: nobody is paired twice`);
    assert.equal(games.filter((g) => g.player2Id === null).length, 1, `round ${round}: exactly one bye`);

    for (const g of games.filter((g) => g.status === 'PENDING')) {
      const r = random();
      await service.recordResult(t.id, g.id, r < 0.4 ? 'white' : r < 0.75 ? 'black' : 'draw');
    }
  }

  const all = await db.match.findMany({ where: { tournamentId: t.id }, orderBy: { round: 'asc' } });
  const played = all.filter((g) => g.player2Id !== null);
  const meetings = played.map((g) => [g.player1Id, g.player2Id].sort().join('|'));
  assert.equal(new Set(meetings).size, meetings.length, 'no rematches');
  const byes = all.filter((g) => g.player2Id === null).map((g) => g.player1Id);
  assert.equal(new Set(byes).size, byes.length, 'no second byes');

  // FIDE's absolute colour rules: never the same colour three times in a row, never two more of one colour.
  for (const { id } of FIELD) {
    const colours = played.flatMap((g) => (g.player1Id === id ? ['W'] : g.player2Id === id ? ['B'] : [])).join('');
    assert.doesNotMatch(colours, /WWW|BBB/, `${id} played ${colours}`);
    const whites = [...colours].filter((c) => c === 'W').length;
    assert.ok(Math.abs(2 * whites - colours.length) <= 2, `${id} played ${colours}`);
  }

  // Stored standings match a fresh computation, and the published order follows the tie-breaks.
  const detail = await service.get(t.id);
  const expected = computeStandings(
    FIELD.map((p) => p.id),
    all.map((m) => ({ whiteId: m.player1Id, blackId: m.player2Id, winnerId: m.winnerId, isDraw: m.isDraw, completed: m.status === 'COMPLETED' }))
  );
  for (const p of detail.participants) {
    assert.deepEqual({ score: p.score, buchholz: p.buchholz }, expected.get(p.profileId), p.profileId);
  }
  assert.equal(detail.participants.reduce((sum, p) => sum + p.score, 0), 5 * (4 + 1), 'four games and a bye a round');
  for (let i = 1; i < detail.participants.length; i++) {
    const [a, b] = [detail.participants[i - 1]!, detail.participants[i]!];
    // A sort comparator: negative means `a` belongs above `b`.
    const order = b.score - a.score || b.buchholz - a.buchholz || b.seedRating - a.seedRating || a.profileId.localeCompare(b.profileId);
    assert.ok(order < 0, `${a.profileId} should rank above ${b.profileId}`);
  }
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
  assert.equal(await scoreOf(t.id, game.player1Id!), 1);
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
