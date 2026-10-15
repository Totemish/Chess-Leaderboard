'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from '@/lib/api';
import type { ChessProfile } from '@/types';

export type LiveStatus = 'connecting' | 'live' | 'offline';

/**
 * Subscribes to the API's live broadcasts for as long as the component is
 * mounted, and reports the socket's connection state:
 * - `player_updated`: one player's new ratings, to patch into the list
 * - `leaderboard_changed`: a player joined or left the board, or was renamed; refetch it
 */
export function useLiveUpdates(
  onPlayerUpdated: (profile: ChessProfile) => void,
  onLeaderboardChanged: () => void
): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const handleUpdate = useEffectEvent(onPlayerUpdated);
  const handleChange = useEffectEvent(onLeaderboardChanged);

  useEffect(() => {
    const socket = io(API_URL, { reconnectionDelayMax: 10_000 });
    socket.on('connect', () => setStatus('live'));
    socket.on('disconnect', () => setStatus('offline'));
    socket.on('connect_error', () => setStatus('offline'));
    socket.on('player_updated', (profile: ChessProfile) => handleUpdate(profile));
    socket.on('leaderboard_changed', () => handleChange());
    return () => {
      socket.disconnect();
    };
  }, []);

  return status;
}
