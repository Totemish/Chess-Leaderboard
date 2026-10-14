'use client';

import { useEffect, useState } from 'react';

/** Current time that re-renders every `intervalMs`, for "updated 3 minutes ago" labels. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
