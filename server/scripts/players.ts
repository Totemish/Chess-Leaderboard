/**
 * Admin command for the players on the leaderboard. The database is the only
 * source of truth: members normally add themselves by linking their account
 * on the dashboard; this is for admins (and for local testing).
 *
 *   npm run players -- list
 *   npm run players -- add <chess.com username> [...]                   (also brings back a removed player)
 *   npm run players -- remove <chess.com username> [...]                (preview only)
 *   npm run players -- remove <chess.com username> [...] --yes          (takes them off the leaderboard)
 *   npm run players -- remove <chess.com username> [...] --purge --yes  (deletes them and their history; not for tournament players)
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
  npm run players -- remove <username> [...] [--purge] [--yes]`;

/** Why a player isn't on the leaderboard, for the listing. */
const HIDDEN_BECAUSE = {
  ACTIVE: null,
  CLOSED: 'hidden: closed by Chess.com',
  CLOSED_FAIR_PLAY: 'hidden: closed by Chess.com for fair-play violations',
  MISSING: 'hidden: Chess.com no longer finds this account',
  REMOVED: 'hidden: removed by an admin',
} as const;

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
    const link = p.user ? `linked to ${p.user.email ?? 'a member'}` : 'not linked';
    const hidden = HIDDEN_BECAUSE[p.status];
    console.log(`${p.username.padEnd(26)}${ratings.padEnd(40)}${link}${hidden ? `  (${hidden})` : ''}`);
  }
  const listed = players.filter((p) => p.status === 'ACTIVE').length;
  console.log(`\n${players.length} player${players.length === 1 ? '' : 's'}, ${listed} on the leaderboard.`);
}

async function add(usernames: string[]) {
  const client = new ChessComClient(config.chessComUserAgent);
  for (const [i, raw] of usernames.entries()) {
    try {
      const username = parseChessUsername(raw);
      const result = await syncPlayer(client, username, { restore: true });
      if (!result) console.log(`Skipped ${username}: Chess.com has no such player`);
      else {
        const hidden = HIDDEN_BECAUSE[result.profile.status];
        console.log(`Added ${result.profile.username}${hidden ? ` (${hidden})` : ''}`);
      }
    } catch (error) {
      console.log(`Skipped ${raw}: ${error instanceof Error ? error.message : error}`);
    }
    // Chess.com prefers requests one at a time.
    if (i < usernames.length - 1) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await invalidateLeaderboardCache();
}

/**
 * By default a removal only hides the player: their rating history and past
 * tournament games stay, and `add` brings them back. --purge deletes the row
 * and their rating history, and is refused for anyone who has played in a
 * tournament: their games would lose a player and count as byes, rewriting
 * those standings. Either way their member is unlinked.
 */
async function remove(usernames: string[], purge: boolean, confirmed: boolean) {
  for (const raw of usernames) {
    const id = raw.trim().toLowerCase();
    const profile = await prisma.chessProfile.findUnique({
      where: { id },
      include: {
        user: true,
        _count: { select: { ratingHistories: true, tournaments: true, matchesAsPlayer1: true, matchesAsPlayer2: true } },
      },
    });
    if (!profile) {
      console.log(`${id}: not in the database`);
      continue;
    }
    const { tournaments, matchesAsPlayer1, matchesAsPlayer2 } = profile._count;
    if (purge && tournaments + matchesAsPlayer1 + matchesAsPlayer2 > 0) {
      console.log(`${profile.username}: not purged, because they have played in tournaments. Remove them without --purge instead.`);
      continue;
    }

    const unlinks = profile.user ? `unlinks ${profile.user.email ?? 'a member'}` : null;
    const effects = purge
      ? [`deletes ${profile._count.ratingHistories} rating-history rows`, unlinks]
      : ['hides it from the leaderboard', 'keeps its history and tournament results', unlinks];
    const summary = effects.filter(Boolean).join(', ');

    if (!confirmed) {
      console.log(`Would ${purge ? 'purge' : 'remove'} ${profile.username}: ${summary}`);
      continue;
    }
    if (purge) {
      await prisma.chessProfile.delete({ where: { id } });
    } else {
      await prisma.$transaction([
        prisma.chessProfile.update({ where: { id }, data: { status: 'REMOVED', missingSince: null } }),
        prisma.user.updateMany({ where: { chessProfileId: id }, data: { chessProfileId: null } }),
      ]);
    }
    console.log(`${purge ? 'Purged' : 'Removed'} ${profile.username}: ${summary}`);
  }

  if (confirmed) await invalidateLeaderboardCache();
  else console.log('\nNothing was changed. Run the same command with --yes to apply it.');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const usernames = args.filter((a) => !a.startsWith('--'));
  const confirmed = args.includes('--yes');
  const purge = args.includes('--purge');

  if (command === 'list') return list();
  if ((command === 'add' || command === 'remove') && usernames.length > 0) {
    return command === 'add' ? add(usernames) : remove(usernames, purge, confirmed);
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
