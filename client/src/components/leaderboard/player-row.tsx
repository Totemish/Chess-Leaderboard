'use client';

import useSWR from 'swr';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { API_URL, describeError, fetchJson } from '@/lib/api';
import { chessComUrl, FORMATS, getRating, playerName } from '@/lib/chess';
import { cn } from '@/lib/utils';
import Avatar from '@/components/ui/avatar';
import TitleBadge from '@/components/ui/title-badge';
import RatingChart from '@/components/charts/rating-chart';
import { ErrorMessage } from '@/components/ui/messages';
import { squareTone } from '@/components/ui/square';
import type { ApiResponse, ChessProfile, PlayerDetails, RatingFormat } from '@/types';

/**
 * Rank squares alternate by row position, like the edge file of a board, so
 * tied ranks never break the pattern. A live rating change snaps the square to
 * the "last move" marker, which then fades back slowly.
 */
function squareClasses(position: number, highlighted: boolean) {
  if (highlighted) return 'bg-marker text-on-marker duration-0';
  return cn(squareTone(position), 'duration-[1200ms]');
}

export interface RatingMove {
  /** Net rating change since the page was opened. */
  delta: number;
}

export default function PlayerRow({
  player,
  rank,
  position,
  format,
  isYou,
  move,
  highlighted,
  expanded,
  isLast,
  onToggle,
}: {
  player: ChessProfile;
  /** Place on the full board; null when a search result lies beyond the loaded pages. */
  rank: number | null;
  /** 1-based row position in the rendered list. */
  position: number;
  format: RatingFormat;
  isYou: boolean;
  move: RatingMove | undefined;
  highlighted: boolean;
  expanded: boolean;
  /** The list draws its own outer border, so the last row skips its hairline. */
  isLast: boolean;
  onToggle: () => void;
}) {
  const rating = getRating(player, format);
  const name = playerName(player);
  const panelId = `history-${player.id}`;
  const square = squareClasses(position, highlighted);

  return (
    <li id={`player-${player.id}`} className="scroll-mt-24">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="group flex w-full items-stretch text-left"
      >
        <span
          className={cn(
            'grid size-12 shrink-0 place-items-center text-sm font-bold tabular-nums transition-colors sm:size-14 sm:text-base',
            square
          )}
        >
          <span className="sr-only">Rank </span>
          {rank ?? '–'}
        </span>

        <span
          className={cn(
            'flex min-w-0 flex-1 items-center gap-3 border-b border-line pr-3 pl-3 transition-colors group-hover:bg-paper sm:pl-4',
            expanded && 'bg-paper',
            isLast && !expanded && 'border-b-0'
          )}
        >
          <Avatar src={player.avatarUrl} name={name} size={36} />

          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-semibold text-ink">{name}</span>
              <TitleBadge title={player.title} />
              {isYou && (
                <span className="shrink-0 rounded-[3px] bg-marker px-1 py-px text-[11px] leading-4 font-bold text-on-marker">
                  You
                </span>
              )}
            </span>
            <span className="block truncate text-sm text-ink-faint">@{player.username}</span>
          </span>

          <span className="flex flex-col items-end">
            <span className="text-lg leading-tight font-bold text-ink tabular-nums">
              <span className="sr-only">Rating </span>
              {rating ?? '–'}
            </span>
            {move && move.delta !== 0 && (
              <span
                title="Change since you opened this page"
                className={cn('text-xs font-bold tabular-nums', move.delta > 0 ? 'text-gain' : 'text-loss')}
              >
                {move.delta > 0 ? `+${move.delta}` : `−${Math.abs(move.delta)}`}
              </span>
            )}
          </span>

          <ChevronDown
            aria-hidden="true"
            className={cn('size-4 shrink-0 text-ink-faint transition-transform', expanded && 'rotate-180')}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id={panelId}
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="flex items-stretch">
              {/* The rank square's colour runs down beside the open panel. */}
              <span aria-hidden="true" className={cn('w-12 shrink-0 sm:w-14', square)} />
              <div className={cn('min-w-0 flex-1 bg-paper px-3 py-4 sm:px-4', !isLast && 'border-b border-line')}>
                <PlayerPanel player={player} format={format} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function PlayerPanel({ player, format }: { player: ChessProfile; format: RatingFormat }) {
  const { data, error, isLoading, mutate } = useSWR<ApiResponse<PlayerDetails>>(
    `${API_URL}/api/players/${encodeURIComponent(player.username)}`,
    fetchJson
  );

  const others = FORMATS.filter((f) => f.id !== format);

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <ErrorMessage title="Couldn't load rating history" detail={describeError(error)} onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <div className="h-[268px] animate-pulse rounded-md bg-square-alt/60" aria-label="Loading rating history" />
      ) : (
        <RatingChart histories={data.data.ratingHistories} format={format} current={getRating(player, format)} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
        <dl className="flex gap-x-5">
          {others.map((f) => (
            <div key={f.id} className="flex gap-1.5">
              <dt className="text-ink-faint">{f.label}</dt>
              <dd className="font-semibold text-ink tabular-nums">{getRating(player, f.id) ?? '–'}</dd>
            </div>
          ))}
        </dl>
        <p className="text-ink-faint">
          Synced {formatDistanceToNowStrict(new Date(player.lastUpdated), { addSuffix: true })}.{' '}
          <a
            href={chessComUrl(player.username)}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
          >
            Chess.com profile
          </a>
        </p>
      </div>
    </div>
  );
}
