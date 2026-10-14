/**
 * Admin command for the players on the leaderboard. The database is the only
 * source of truth: members normally add themselves by linking their account
 * on the dashboard; this is for admins (and for local testing).
 *
 *   npm run players -- list
 *   npm run players -- add <chess.com username> [...]
 *   npm run players -- remove <chess.com username> [...]          (preview only)
 *   npm run players -- remove <chess.com username> [...] --yes    (deletes)
 *
 * In production, after `npm run build`: node dist/scripts/players.js <command> …
 */
import { config } from '../config';
import { prisma } from '../services/db.service';
import { ChessComClient, syncPlayer } from '../services/chess.service';
import { invalidateLeaderboardCache, redis } from '../services/redis.service';
import { parseChessUsername } from '../lib/validate';

const USAGE = `Usage:
  npm run players -- list
  npm run players -- add <username> [...]
  npm run players -- remove <username> [...] [--yes]`;

async function list() {
  const players = await prisma.chessProfile.findMany({
    orderBy: { username: 'asc' },
    include: { user: { select: { email: true } } },
  });
  if (players.length === 0) {
    console.log('No players yet.');
    return;
  }
  for (const p of players) {
    const ratings = `rapid ${p.rapidRating ?? '–'}  blitz ${p.blitzRating ?? '–'}  bullet ${p.bulletRating ?? '–'}`;
    console.log(`${p.username.padEnd(26)}${ratings.padEnd(40)}${p.user ? `linked to ${p.user.email ?? 'a member'}` : 'not linked'}`);
  }
  console.log(`\n${players.length} player${players.length === 1 ? '' : 's'}.`);
}

async function add(usernames: string[]) {
  const client = new ChessComClient(config.chessComUserAgent);
  for (const [i, raw] of usernames.entries()) {
    try {
      const username = parseChessUsername(raw);
      const result = await syncPlayer(client, username);
      console.log(result ? `Added ${result.profile.username}` : `Skipped ${username}: Chess.com has no such player`);
    } catch (error) {
      console.log(`Skipped ${raw}: ${error instanceof Error ? error.message : error}`);
    }
    // Chess.com prefers requests one at a time.
    if (i < usernames.length - 1) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await invalidateLeaderboardCache();
}

async function remove(usernames: string[], confirmed: boolean) {
  for (const raw of usernames) {
    const id = raw.trim().toLowerCase();
    const profile = await prisma.chessProfile.findUnique({
      where: { id },
      include: { user: true, _count: { select: { ratingHistories: true, tournaments: true } } },
    });
    if (!profile) {
      console.log(`${id}: not in the database`);
      continue;
    }

    // Deleting a player also deletes their rating history and tournament entries
    // (cascade), unlinks their member account, and leaves their past games
    // showing "Removed player".
    const effects = [
      `${profile._count.ratingHistories} rating-history rows`,
      `${profile._count.tournaments} tournament entries`,
      profile.user ? `unlinks ${profile.user.email ?? 'a member'}` : null,
    ].filter(Boolean);

    if (!confirmed) {
      console.log(`Would remove ${profile.username} (${effects.join(', ')})`);
      continue;
    }
    await prisma.chessProfile.delete({ where: { id } });
    console.log(`Removed ${profile.username} (${effects.join(', ')})`);
  }

  if (confirmed) await invalidateLeaderboardCache();
  else console.log('\nNothing was deleted. Run the same command with --yes to delete.');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const usernames = args.filter((a) => !a.startsWith('--'));
  const confirmed = args.includes('--yes');

  if (command === 'list') return list();
  if ((command === 'add' || command === 'remove') && usernames.length > 0) {
    return command === 'add' ? add(usernames) : remove(usernames, confirmed);
  }
  console.log(USAGE);
  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis?.quit(); // an open Redis connection would keep the process alive
  });
