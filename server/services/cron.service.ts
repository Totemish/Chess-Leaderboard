import cron, { type ScheduledTask } from 'node-cron';
import type { Server } from 'socket.io';
import { prisma } from './db.service';
import { recordMissing, syncPlayer, type ChessComClient, type SyncResult } from './chess.service';
import { invalidateLeaderboardCache } from './redis.service';

const PAUSE_BETWEEN_PLAYERS_MS = 500;

/**
 * Tells open pages about a sync: a changed row is patched in place, while a
 * player joining or leaving the board (or renamed) makes pages refetch it.
 */
export function broadcastSync(io: Server, result: SyncResult) {
  if (result.relisted) io.emit('leaderboard_changed');
  else io.emit('player_updated', result.profile);
}

/** Re-syncs every tracked player from Chess.com, one at a time. */
export async function syncAllPlayers(io: Server, client: ChessComClient): Promise<void> {
  // Players an admin removed stay off the leaderboard, so there is nothing to fetch for them.
  const players = await prisma.chessProfile.findMany({ where: { status: { not: 'REMOVED' } }, select: { id: true } });
  console.log(`Syncing ${players.length} players from Chess.com…`);

  for (const { id } of players) {
    try {
      const result = (await syncPlayer(client, id)) ?? (await recordMissing(id));
      if (result) {
        // Clear the cache before announcing the update, so a client that
        // refetches on this event reads fresh data, not the stale cache.
        if (result.changed) await invalidateLeaderboardCache();
        broadcastSync(io, result);
      }
    } catch (error) {
      // One failing player must not stop the rest of the sync.
      console.warn(`Sync failed for ${id}:`, error instanceof Error ? error.message : error);
    }
    await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_PLAYERS_MS));
  }
  console.log('Sync finished.');
}

export function startSyncJob(io: Server, client: ChessComClient, schedule: string): ScheduledTask {
  // noOverlap skips a tick while the previous sync is still running.
  return cron.schedule(schedule, () => syncAllPlayers(io, client), { name: 'chess-com-sync', noOverlap: true });
}
