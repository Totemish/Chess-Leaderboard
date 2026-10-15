import type { Match, Prisma, PrismaClient, TournamentStatus } from '@prisma/client';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors';
import type { GameResult, TimeControl } from '../lib/validate';
import type { PairingStrategy } from '../domain/pairing/types';
import { computeStandings, type GameRecord } from '../domain/standings';

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { maxWait: 5_000, timeout: 20_000 };

const RATING_FIELD = { rapid: 'rapidRating', blitz: 'blitzRating', bullet: 'bulletRating' } as const;

const toGame = (m: Pick<Match, 'player1Id' | 'player2Id' | 'winnerId' | 'isDraw' | 'status'>): GameRecord => ({
  whiteId: m.player1Id,
  blackId: m.player2Id,
  winnerId: m.winnerId,
  isDraw: m.isDraw,
  completed: m.status === 'COMPLETED',
});

/** player1 is White, so "white" means player1 won. */
const resultFields = (match: Pick<Match, 'player1Id' | 'player2Id'>, result: GameResult) => ({
  isDraw: result === 'draw',
  winnerId: result === 'white' ? match.player1Id : result === 'black' ? match.player2Id : null,
});

const withUserName = { include: { user: { select: { name: true } } } } as const;

const DETAIL = {
  participants: {
    include: { profile: withUserName },
    // The last key only makes full ties stable, so places never swap between page loads.
    orderBy: [{ score: 'desc' }, { buchholz: 'desc' }, { seedRating: 'desc' }, { profileId: 'asc' }],
  },
  matches: {
    include: { player1: withUserName, player2: withUserName, winner: true },
    orderBy: { round: 'desc' },
  },
} satisfies Prisma.TournamentInclude;

/**
 * Tournament lifecycle: PENDING (registration) -> ONGOING (rounds) -> COMPLETED.
 *
 * Concurrency: every write starts by locking the tournament row (see `lock`),
 * so writes to one tournament run one at a time even across server
 * instances. Standings are recomputed from the games inside that critical
 * section, never incremented, so retries and double-clicks can't corrupt them.
 */
export class TournamentService {
  constructor(
    private readonly db: PrismaClient,
    private readonly pairing: PairingStrategy
  ) {}

  list() {
    return this.db.tournament.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { participants: true } } },
    });
  }

  async get(id: string) {
    const tournament = await this.db.tournament.findUnique({ where: { id }, include: DETAIL });
    if (!tournament) throw new NotFoundError('Tournament not found.');
    return tournament;
  }

  create(name: string, format: TimeControl) {
    return this.db.tournament.create({ data: { name, format } });
  }

  /**
   * Registers a leaderboard player, seeded by their rating in the tournament's
   * time control. Admins build the field, so nobody can enter themselves; the
   * list locks once round 1 is paired.
   */
  async addPlayer(tournamentId: string, profileId: string) {
    return this.db.$transaction(async (tx) => {
      const tournament = await this.lock(tx, tournamentId, ['PENDING'], 'Players can only be added before round 1 is paired.');
      const profile = await tx.chessProfile.findUnique({ where: { id: profileId } });
      if (!profile) throw new NotFoundError(`${profileId} isn't on the leaderboard.`);
      if (profile.status !== 'ACTIVE') {
        throw new BadRequestError(`${profile.username} isn't on the leaderboard any more, so they can't be added.`);
      }
      // The row lock serialises registrations, so this check can't race another add.
      const existing = await tx.tournamentParticipant.findUnique({
        where: { tournamentId_profileId: { tournamentId, profileId } },
      });
      if (existing) throw new ConflictError(`${profile.username} is already registered.`);

      const field = RATING_FIELD[tournament.format as TimeControl] ?? 'rapidRating';
      return tx.tournamentParticipant.create({
        data: { tournamentId, profileId, seedRating: profile[field] ?? 0 },
        include: { profile: withUserName },
      });
    }, TX_OPTIONS);
  }

  /** Takes a player off the list before round 1 is paired. */
  async removePlayer(tournamentId: string, profileId: string) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, tournamentId, ['PENDING'], 'Players can only be removed before round 1 is paired.');
      const { count } = await tx.tournamentParticipant.deleteMany({ where: { tournamentId, profileId } });
      if (count === 0) throw new NotFoundError(`${profileId} isn't registered for this tournament.`);
    }, TX_OPTIONS);
  }

  /** Pairs the next round. Byes are stored as completed games won by the player. */
  async pairNextRound(tournamentId: string) {
    return this.db.$transaction(async (tx) => {
      const tournament = await this.lock(tx, tournamentId, ['PENDING', 'ONGOING'], 'This tournament has finished.');
      const participants = await tx.tournamentParticipant.findMany({ where: { tournamentId } });
      const matches = await tx.match.findMany({ where: { tournamentId } });

      if (participants.length < 2) {
        throw new BadRequestError('At least 2 players must register before a round can be paired.');
      }
      const unfinished = matches.filter((m) => m.round === tournament.currentRound && m.status === 'PENDING').length;
      if (unfinished > 0) {
        // Also what a second, concurrent "Pair" click hits once the first has committed.
        throw new ConflictError(
          `Round ${tournament.currentRound} still has ${unfinished} unfinished game${unfinished === 1 ? '' : 's'}.`
        );
      }

      const round = tournament.currentRound + 1;
      const standings = computeStandings(participants.map((p) => p.profileId), matches.map(toGame));
      const pairings = this.pairing.pairRound(
        participants.map((p) => ({ id: p.profileId, score: standings.get(p.profileId)!.score, rating: p.seedRating })),
        matches
          .filter((m) => m.player1Id !== null)
          .map((m) => ({ round: m.round, whiteId: m.player1Id!, blackId: m.player2Id }))
      );

      await tx.match.createMany({
        data: pairings.map(({ whiteId, blackId }) => ({
          tournamentId,
          round,
          player1Id: whiteId,
          player2Id: blackId,
          status: blackId === null ? 'COMPLETED' : 'PENDING',
          winnerId: blackId === null ? whiteId : null,
        })),
      });
      await tx.tournament.update({ where: { id: tournamentId }, data: { currentRound: round, status: 'ONGOING' } });
      await this.refreshStandings(tx, tournamentId);
      return { round, boards: pairings.length };
    }, TX_OPTIONS);
  }

  /** Records a game's result. player1 is White, so "white" means player1 won. */
  async recordResult(tournamentId: string, matchId: string, result: GameResult) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, tournamentId, ['ONGOING'], 'Results can only be entered while the tournament is in progress.');
      const match = await tx.match.findUnique({ where: { id: matchId } });
      if (!match || match.tournamentId !== tournamentId) throw new NotFoundError('That game is not part of this tournament.');
      if (match.player2Id === null) throw new BadRequestError('A bye has no result to enter.');

      // Conditional update: only a pending game can be completed, so a retried
      // request can never score the same game twice.
      const { count } = await tx.match.updateMany({
        where: { id: matchId, status: 'PENDING' },
        data: { status: 'COMPLETED', ...resultFields(match, result) },
      });
      if (count === 0) throw new ConflictError('This result has already been entered.');
      await this.refreshStandings(tx, tournamentId);
    }, TX_OPTIONS);
  }

  /**
   * Corrects a result entered by mistake. Only the latest round can change:
   * the rounds after an earlier one were paired from its results.
   */
  async changeResult(tournamentId: string, matchId: string, result: GameResult) {
    await this.db.$transaction(async (tx) => {
      const tournament = await this.lock(tx, tournamentId, ['ONGOING'], 'Results can only be changed while the tournament is in progress.');
      const match = await tx.match.findUnique({ where: { id: matchId } });
      if (!match || match.tournamentId !== tournamentId) throw new NotFoundError('That game is not part of this tournament.');
      if (match.player2Id === null) throw new BadRequestError('A bye has no result to change.');
      if (match.status !== 'COMPLETED') throw new ConflictError("This game has no result yet. Enter it instead.");
      if (match.round !== tournament.currentRound) {
        throw new ConflictError(
          `Only round ${tournament.currentRound} results can be changed: the rounds after round ${match.round} were paired from its results.`
        );
      }
      await tx.match.update({ where: { id: matchId }, data: resultFields(match, result) });
      await this.refreshStandings(tx, tournamentId);
    }, TX_OPTIONS);
  }

  /** Closes the tournament once every game has a result. */
  async finish(tournamentId: string) {
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, tournamentId, ['ONGOING'], 'Only a tournament in progress can be finished.');
      const unfinished = await tx.match.count({ where: { tournamentId, status: 'PENDING' } });
      if (unfinished > 0) {
        throw new ConflictError(`Enter the remaining ${unfinished} result${unfinished === 1 ? '' : 's'} before finishing.`);
      }
      await this.refreshStandings(tx, tournamentId);
      return tx.tournament.update({ where: { id: tournamentId }, data: { status: 'COMPLETED' } });
    }, TX_OPTIONS);
  }

  /**
   * Deletes the tournament with its registrations, pairings and results (the
   * schema cascades both). Players and their leaderboard ratings are untouched.
   */
  async remove(tournamentId: string) {
    const { count } = await this.db.tournament.deleteMany({ where: { id: tournamentId } });
    if (count === 0) throw new NotFoundError('Tournament not found.');
  }

  /**
   * Locks the tournament row until the transaction ends, like SELECT … FOR
   * UPDATE but written as a conditional UPDATE so it also checks the status.
   * A second transaction on the same tournament waits here, then reads the
   * state the first one committed.
   */
  private async lock(tx: Tx, id: string, allowed: TournamentStatus[], wrongStatusMessage: string) {
    const { count } = await tx.tournament.updateMany({
      where: { id, status: { in: allowed } },
      data: { updatedAt: new Date() },
    });
    if (count === 0) {
      const exists = await tx.tournament.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new NotFoundError('Tournament not found.');
      throw new ConflictError(wrongStatusMessage);
    }
    return tx.tournament.findUniqueOrThrow({ where: { id } });
  }

  /** Recomputes every participant's score and Buchholz from the games. */
  private async refreshStandings(tx: Tx, tournamentId: string) {
    const participants = await tx.tournamentParticipant.findMany({ where: { tournamentId } });
    const matches = await tx.match.findMany({ where: { tournamentId } });
    const standings = computeStandings(participants.map((p) => p.profileId), matches.map(toGame));
    for (const p of participants) {
      const next = standings.get(p.profileId)!;
      if (next.score !== p.score || next.buchholz !== p.buchholz) {
        await tx.tournamentParticipant.update({ where: { id: p.id }, data: next });
      }
    }
  }
}
