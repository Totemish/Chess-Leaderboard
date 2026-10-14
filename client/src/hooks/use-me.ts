'use client';

import useSWR from 'swr';
import { useSession } from 'next-auth/react';
import { fetchJson } from '@/lib/api';
import type { ApiResponse, User } from '@/types';

export const ME_KEY = '/api/backend/auth/me';

/**
 * The signed-in user's backend record (role, linked Chess.com profile).
 * Skips the request entirely for signed-out visitors.
 */
export function useMe() {
  const { data: session, status } = useSession();
  const signedIn = status === 'authenticated' && !!session?.user;

  const { data, error, isLoading, mutate } = useSWR<ApiResponse<User>>(signedIn ? ME_KEY : null, fetchJson);

  return {
    session,
    sessionStatus: status,
    signedIn,
    me: data?.data ?? null,
    isAdmin: data?.data?.role === 'ADMIN',
    error: error as Error | undefined,
    isLoading: status === 'loading' || (signedIn && isLoading),
    mutate,
  };
}
