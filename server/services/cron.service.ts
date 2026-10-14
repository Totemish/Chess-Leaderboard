import cron, { type ScheduledTask } from 'node-cron';
import type { Server } from 'socket.io';
import { prisma } from './db.service';
import { syncPlayer, type ChessComClient } from './chess.service';
import { invalidateLeaderboardCache } from './redis.service';

const PAUSE_BETWEEN_PLAYERS_MS = 500;

/** Re-syncs every tracked player from Chess.com, one at a time. */
export async function syncAllPlayers(io: Server, client: ChessComClient): Promise<void> {
  const players = await prisma.chessProfile.findMany({ select: { username: true } });
  console.log(`Syncing ${players.length} players from Chess.com…`);

  for (const { username } of players) {
    try {
      const result = await syncPlayer(client, username);
      if (result) {
        // Clear the cache before announcing the update, so a client that
        // refetches on this event reads fresh data, not the stale cache.
        if (result.changed) await invalidateLeaderboardCache();
        io.emit('player_updated', result.profile);
      }
    } catch (error) {
      // One failing player must not stop the rest of the sync.
      console.warn(`Sync failed for ${username}:`, error instanceof Error ? error.message : error);
    }
    await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_PLAYERS_MS));
  }
  console.log('Sync finished.');
}

export function startSyncJob(io: Server, client: ChessComClient, schedule: string): ScheduledTask {
  // noOverlap skips a tick while the previous sync is still running.
  return cron.schedule(schedule, () => syncAllPlayers(io, client), { name: 'chess-com-sync', noOverlap: true });
}
