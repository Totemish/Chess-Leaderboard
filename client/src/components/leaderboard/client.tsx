'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { signIn } from 'next-auth/react';
import { formatDistanceStrict } from 'date-fns';
import { Search, X } from 'lucide-react';
import { API_URL, describeError, fetchJson } from '@/lib/api';
import { competitionRanks, formatLabel, getRating, ordinal } from '@/lib/chess';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/use-debounce';
import { useLiveUpdates, type LiveStatus } from '@/hooks/use-live-updates';
import { useMe } from '@/hooks/use-me';
import { useNow } from '@/hooks/use-now';
import { buttonStyles } from '@/components/ui/button';
import { EmptyMessage, ErrorMessage } from '@/components/ui/messages';
import FormatTabs from './format-tabs';
import PlayerRow, { type RatingMove } from './player-row';
import type { ChessProfile, LeaderboardResponse, RatingFormat } from '@/types';

/** How long a rank square keeps the "last move" highlight after a live change. */
const HIGHLIGHT_MS = 8000;

const isNewer = (a: ChessProfile, b: ChessProfile) => Date.parse(a.lastUpdated) >= Date.parse(b.lastUpdated);

export default function LeaderboardClient({ format }: { format: RatingFormat }) {
  const label = formatLabel(format);

  const [query, setQuery] = useState('');
  const search = useDebounce(query.trim(), 250);
  const searching = search.length > 0;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { me, signedIn, sessionStatus } = useMe();

  // The full ranking, fetched page by page (cursor = last player id).
  const board = useSWRInfinite<LeaderboardResponse>(
    (index, previous: LeaderboardResponse | null) => {
      if (previous && !previous.nextCursor) return null;
      const cursor = index > 0 && previous?.nextCursor ? `?cursor=${encodeURIComponent(previous.nextCursor)}` : '';
      return `${API_URL}/api/leaderboard/${format}${cursor}`;
    },
    fetchJson,
    { revalidateOnFocus: false }
  );
  const pages = board.data;
  const hasMore = !!pages?.[pages.length - 1]?.nextCursor;
  const loadingMore = board.isValidating && !!pages && board.size > pages.length;

  // Search runs on the server so it also finds players beyond the loaded pages.
  const results = useSWR<LeaderboardResponse>(
    searching ? `${API_URL}/api/leaderboard/${format}?search=${encodeURIComponent(search)}` : null,
    fetchJson,
    { keepPreviousData: true }
  );

  // Live updates arrive one player at a time; keep them as an overlay on the fetched pages.
  const [live, setLive] = useState<ReadonlyMap<string, ChessProfile>>(new Map());
  const [moves, setMoves] = useState<ReadonlyMap<string, RatingMove & { at: number }>>(new Map());
  // Advanced only when a highlight expires, so render never reads the wall clock.
  const [clock, setClock] = useState(() => Date.now());

  // Schedule a re-render for the next highlight that hasn't expired yet.
  useEffect(() => {
    const next = Math.min(...[...moves.values()].map((m) => m.at + HIGHLIGHT_MS).filter((t) => t > clock));
    if (!Number.isFinite(next)) return;
    const id = setTimeout(() => setClock(Date.now()), Math.max(0, next - Date.now()));
    return () => clearTimeout(id);
  }, [moves, clock]);

  const isHighlighted = (id: string) => {
    const move = moves.get(id);
    return !!move && move.at + HIGHLIGHT_MS > clock;
  };

  const ranked = useMemo(() => {
    const byId = new Map<string, ChessProfile>();
    for (const page of pages ?? []) for (const p of page.data) byId.set(p.id, p);

    // A new player only joins the visible list if they rank above the last loaded row.
    const floor = hasMore ? Math.min(...[...byId.values()].map((p) => getRating(p, format) ?? Infinity)) : -Infinity;
    for (const [id, update] of live) {
      const current = byId.get(id);
      if (current) {
        if (isNewer(update, current)) byId.set(id, { ...current, ...update });
      } else if ((getRating(update, format) ?? -Infinity) >= floor) {
        byId.set(id, update);
      }
    }

    return [...byId.values()]
      .filter((p) => getRating(p, format) !== null)
      .sort((a, b) => (getRating(b, format) ?? 0) - (getRating(a, format) ?? 0) || a.id.localeCompare(b.id));
  }, [pages, live, hasMore, format]);

  const rankById = useMemo(() => {
    const ranks = competitionRanks(ranked.map((p) => getRating(p, format)));
    return new Map(ranked.map((p, i) => [p.id, ranks[i]]));
  }, [ranked, format]);

  const liveStatus = useLiveUpdates((update) => {
    const before = ranked.find((p) => p.id === update.id);
    const oldRating = before ? getRating(before, format) : null;
    const newRating = getRating(update, format);
    setLive((prev) => new Map(prev).set(update.id, update));

    // The sync job re-broadcasts every player; only real rating changes get highlighted.
    if (oldRating === null || newRating === null || oldRating === newRating) return;
    const at = Date.now();
    setMoves((prev) =>
      new Map(prev).set(update.id, { delta: (prev.get(update.id)?.delta ?? 0) + newRating - oldRating, at })
    );
  });

  const rows = searching
    ? (results.data?.data ?? [])
        .map((p) => {
          const update = live.get(p.id);
          return update && isNewer(update, p) ? { ...p, ...update } : p;
        })
        .filter((p) => getRating(p, format) !== null)
    : ranked;

  const lastSync = ranked.reduce((max, p) => Math.max(max, Date.parse(p.lastUpdated)), 0);
  const myId = me?.chessProfileId ?? null;

  const showMe = () => {
    if (!myId) return;
    const row = document.getElementById(`player-${myId}`);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    row?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    row?.querySelector('button')?.focus({ preventScroll: true });
  };

  let content: React.ReactNode;
  if (board.error && !pages) {
    content = (
      <ErrorMessage
        title="Couldn't load the leaderboard"
        detail={`The ratings server didn't respond (${describeError(board.error)}). Check your connection and try again.`}
        onRetry={() => board.mutate()}
      />
    );
  } else if (!pages || (searching && !results.data && !results.error)) {
    content = <SkeletonList rows={searching ? 3 : 8} />;
  } else if (searching && results.error) {
    content = <ErrorMessage title="Search failed" detail={describeError(results.error)} onRetry={() => results.mutate()} />;
  } else if (rows.length === 0) {
    content = searching ? (
      <EmptyMessage title={`No player matches “${search}”`}>
        <p>Check the spelling, or search by Chess.com username.</p>
        <button type="button" onClick={() => setQuery('')} className={buttonStyles({ variant: 'secondary', size: 'sm', className: 'mt-3' })}>
          Clear search
        </button>
      </EmptyMessage>
    ) : (
      <EmptyMessage title={`No ${label.toLowerCase()} ratings yet`}>
        <p>
          Players show up here once their Chess.com account is linked.{' '}
          <Link href="/dashboard" className="font-semibold text-ink underline underline-offset-2">
            Link your account
          </Link>
        </p>
      </EmptyMessage>
    );
  } else {
    content = (
      <>
        <ol
          aria-label={`${label} ranking`}
          className={cn('overflow-hidden rounded-lg border border-line bg-surface', searching && results.isValidating && 'opacity-60')}
        >
          {rows.map((player, i) => (
            <PlayerRow
              key={player.id}
              player={player}
              rank={rankById.get(player.id) ?? null}
              position={i + 1}
              format={format}
              isYou={player.id === myId}
              move={moves.get(player.id)}
              highlighted={isHighlighted(player.id)}
              expanded={expandedId === player.id}
              isLast={i === rows.length - 1}
              onToggle={() => setExpandedId((id) => (id === player.id ? null : player.id))}
            />
          ))}
        </ol>

        {!searching && hasMore && (
          <button
            type="button"
            onClick={() => board.setSize(board.size + 1)}
            disabled={loadingMore}
            className={buttonStyles({ variant: 'secondary', className: 'mt-6 self-start' })}
          >
            {loadingMore ? 'Loading players…' : 'Show more players'}
          </button>
        )}
      </>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pt-8 pb-16 sm:pt-12">
      <h1 className="sr-only">{label} leaderboard</h1>
      <FormatTabs active={format} />
      <p className="mt-4 max-w-prose text-ink-soft">
        IIT Roorkee players ranked by their Chess.com {label.toLowerCase()} rating.
      </p>

      <div className="mt-8 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
        <SyncStatus status={liveStatus} lastSync={lastSync} count={!hasMore && pages ? ranked.length : null} />
        <SearchField value={query} onChange={setQuery} />
      </div>

      {sessionStatus !== 'loading' && !searching && pages && (
        <StandingNote
          signedIn={signedIn}
          linked={!!myId}
          checkedLink={!!me}
          rank={myId ? (rankById.get(myId) ?? null) : null}
          rating={me?.chessProfile ? getRating(me.chessProfile, format) : null}
          formatName={label.toLowerCase()}
          onShowMe={showMe}
        />
      )}

      <section aria-live="polite" aria-busy={!pages} className="mt-4 flex flex-col">
        {searching && results.data && (
          <p className="mb-3 text-sm text-ink-soft">
            {rows.length === 1 ? '1 player matches' : `${rows.length} players match`} “{search}”
          </p>
        )}
        {content}
      </section>
    </div>
  );
}

function SyncStatus({ status, lastSync, count }: { status: LiveStatus; lastSync: number; count: number | null }) {
  const now = useNow();
  return (
    <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-soft">
      <span className="inline-flex items-center gap-2" title={status === 'offline' ? 'Reconnecting to the ratings server' : undefined}>
        <span
          aria-hidden="true"
          className={cn('size-2 rounded-full', status === 'live' ? 'bg-plot' : 'border border-line-strong')}
        />
        {status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Live updates paused'}
      </span>
      {lastSync > 0 && (
        <span>
          Synced{' '}
          {now - lastSync < 60_000 ? 'just now' : formatDistanceStrict(lastSync, now, { addSuffix: true })}
        </span>
      )}
      {count !== null && <span>{count === 1 ? '1 player' : `${count} players`}</span>}
    </p>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative w-full sm:w-72">
      <label htmlFor="player-search" className="sr-only">
        Search players
      </label>
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
      <input
        id="player-search"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onChange('')}
        placeholder="Search name or username"
        autoComplete="off"
        spellCheck={false}
        className="h-10 w-full rounded-md border border-line-strong bg-surface pr-9 pl-9 text-sm text-ink placeholder:text-ink-faint"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded text-ink-faint hover:text-ink"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}

function StandingNote({
  signedIn,
  linked,
  checkedLink,
  rank,
  rating,
  formatName,
  onShowMe,
}: {
  signedIn: boolean;
  linked: boolean;
  checkedLink: boolean;
  rank: number | null;
  rating: number | null;
  formatName: string;
  onShowMe: () => void;
}) {
  const link = 'font-semibold text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink';
  let message: React.ReactNode = null;

  if (!signedIn) {
    message = (
      <>
        Play at IIT Roorkee?{' '}
        <button type="button" onClick={() => signIn()} className={link}>
          Sign in
        </button>{' '}
        and link your Chess.com account to join the leaderboard.
      </>
    );
  } else if (checkedLink && !linked) {
    message = (
      <>
        You&apos;re not on the leaderboard yet.{' '}
        <Link href="/dashboard" className={link}>
          Link your Chess.com account
        </Link>{' '}
        to join.
      </>
    );
  } else if (linked && rank !== null) {
    message = (
      <>
        You&apos;re <strong className="font-bold text-ink">{ordinal(rank)}</strong> in {formatName}
        {rating !== null && <> at {rating}</>}.{' '}
        <button type="button" onClick={onShowMe} className={link}>
          Show my row
        </button>
      </>
    );
  } else if (linked && rating === null) {
    message = <>You don&apos;t have a Chess.com {formatName} rating yet. Play a rated {formatName} game to get one.</>;
  }

  if (!message) return null;
  return <p className="mt-6 rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink-soft">{message}</p>;
}

function SkeletonList({ rows }: { rows: number }) {
  return (
    <ol aria-hidden="true" className="overflow-hidden rounded-lg border border-line bg-surface">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex">
          <span className={cn('size-12 shrink-0 sm:size-14', i % 2 === 0 ? 'bg-square/50' : 'bg-square-alt')} />
          <span className={cn('flex flex-1 items-center gap-3 px-3 sm:px-4', i < rows - 1 && 'border-b border-line')}>
            <span className="size-9 animate-pulse rounded-md bg-square-alt" />
            <span className="h-3 w-32 animate-pulse rounded bg-square-alt" />
            <span className="ml-auto h-4 w-12 animate-pulse rounded bg-square-alt" />
          </span>
        </li>
      ))}
    </ol>
  );
}
