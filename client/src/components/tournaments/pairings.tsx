'use client';

import { useState } from 'react';
import { describeError, sendJson } from '@/lib/api';
import { formatScore, playerName } from '@/lib/chess';
import { isBye, resultNotation } from '@/lib/tournament';
import { cn } from '@/lib/utils';
import Avatar from '@/components/ui/avatar';
import { buttonStyles } from '@/components/ui/button';
import { squareTone } from '@/components/ui/square';
import type { ChessProfile, Match } from '@/types';

type Choice = 'white' | 'draw' | 'black';

const CHOICES: { id: Choice; label: string }[] = [
  { id: 'white', label: '1–0' },
  { id: 'draw', label: '½–½' },
  { id: 'black', label: '0–1' },
];

/** One round's games, board 1 first, with result entry for admins. */
export default function Pairings({
  tournamentId,
  matches,
  scoreOf,
  myProfileId,
  canRecord,
  onRecorded,
}: {
  tournamentId: string;
  matches: Match[];
  scoreOf: Map<string, number>;
  myProfileId: string | null;
  canRecord: boolean;
  onRecorded: () => Promise<unknown>;
}) {
  return (
    <ol className="overflow-hidden rounded-lg border border-line bg-surface">
      {matches.map((match, i) => (
        <li key={match.id} className="flex items-stretch">
          <span
            className={cn('grid w-12 shrink-0 place-items-center text-sm font-bold tabular-nums sm:w-14', squareTone(i + 1))}
          >
            <span className="sr-only">Board </span>
            {i + 1}
          </span>
          <div className={cn('min-w-0 flex-1 px-3 py-3 sm:px-4', i < matches.length - 1 && 'border-b border-line')}>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,1fr)]">
              <PlayerCell
                profile={match.player1}
                colour={isBye(match) ? null : 'white'}
                score={match.player1Id ? scoreOf.get(match.player1Id) : undefined}
                won={match.status === 'COMPLETED' && !match.isDraw && match.winnerId === match.player1Id}
                isYou={!!myProfileId && match.player1Id === myProfileId}
                className="col-start-1 row-start-1 sm:justify-end sm:text-right"
                reverse
              />
              <ResultCell match={match} />
              {isBye(match) ? (
                <p className="col-start-1 row-start-2 text-sm text-ink-faint sm:col-start-3 sm:row-start-1">
                  No opponent this round (1 point)
                </p>
              ) : (
                <PlayerCell
                  profile={match.player2}
                  colour="black"
                  score={match.player2Id ? scoreOf.get(match.player2Id) : undefined}
                  won={match.status === 'COMPLETED' && !match.isDraw && match.winnerId === match.player2Id}
                  isYou={!!myProfileId && match.player2Id === myProfileId}
                  className="col-start-1 row-start-2 sm:col-start-3 sm:row-start-1"
                />
              )}
            </div>
            {canRecord && match.status === 'PENDING' && !isBye(match) && (
              <ResultEntry tournamentId={tournamentId} match={match} onRecorded={onRecorded} />
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A tiny square in the piece colour: a light square with an outline for White, a dark one for Black. */
function ColourSwatch({ colour }: { colour: 'white' | 'black' }) {
  return (
    <span
      title={colour === 'white' ? 'Plays White' : 'Plays Black'}
      className={cn(
        'size-3 shrink-0 rounded-[2px] border',
        colour === 'white' ? 'border-line-strong bg-paper' : 'border-ink bg-ink'
      )}
    >
      <span className="sr-only">{colour === 'white' ? 'White: ' : 'Black: '}</span>
    </span>
  );
}

function PlayerCell({
  profile,
  colour,
  score,
  won,
  isYou,
  reverse = false,
  className,
}: {
  profile: ChessProfile | null;
  colour: 'white' | 'black' | null;
  score: number | undefined;
  won: boolean;
  isYou: boolean;
  reverse?: boolean;
  className?: string;
}) {
  const name = profile ? playerName(profile) : 'Removed player';
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', reverse && 'sm:flex-row-reverse', className)}>
      {colour && <ColourSwatch colour={colour} />}
      <Avatar src={profile?.avatarUrl} name={name} size={28} />
      <span className="min-w-0 truncate">
        <span className={cn('font-semibold', won ? 'text-ink' : 'text-ink-soft')}>{name}</span>
        {isYou && (
          <span className="ml-1.5 rounded-[3px] bg-marker px-1 py-px align-[1px] text-[11px] font-bold text-on-marker">You</span>
        )}
      </span>
      {score !== undefined && (
        <span className="shrink-0 text-sm text-ink-faint tabular-nums" title="Tournament points">
          {formatScore(score)}
        </span>
      )}
    </div>
  );
}

function ResultCell({ match }: { match: Match }) {
  const result = resultNotation(match);
  return (
    <p
      className={cn(
        'col-start-2 row-span-2 row-start-1 text-center tabular-nums sm:row-span-1',
        result ? 'font-bold text-ink' : 'text-ink-faint'
      )}
    >
      {result ?? (
        <>
          <span aria-hidden="true">–</span>
          <span className="sr-only">Not played yet</span>
        </>
      )}
    </p>
  );
}

function ResultEntry({
  tournamentId,
  match,
  onRecorded,
}: {
  tournamentId: string;
  match: Match;
  onRecorded: () => Promise<unknown>;
}) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const white = match.player1 ? playerName(match.player1) : 'White';
  const black = match.player2 ? playerName(match.player2) : 'Black';
  const spoken: Record<Choice, string> = { white: `${white} (White) wins`, draw: 'draw', black: `${black} (Black) wins` };

  async function save() {
    if (!choice) return;
    setPending(true);
    setError(null);
    try {
      await sendJson(`/api/backend/tournaments/${tournamentId}/matches/${match.id}/result`, 'POST', { result: choice });
      await onRecorded();
    } catch (err) {
      setError(describeError(err));
      setPending(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <span id={`result-label-${match.id}`} className="mr-1 text-sm text-ink-soft">
        Result
      </span>
      <div role="group" aria-labelledby={`result-label-${match.id}`} className="flex gap-1">
        {CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setChoice(c.id)}
            aria-pressed={choice === c.id}
            aria-label={`${c.label}, ${spoken[c.id]}`}
            disabled={pending}
            className={cn(
              'h-8 min-w-12 rounded-md border px-2 text-sm font-bold tabular-nums transition-colors',
              choice === c.id
                ? 'border-transparent bg-marker text-on-marker'
                : 'border-line-strong bg-surface text-ink hover:bg-square-alt'
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      {choice && (
        <>
          <button type="button" onClick={save} disabled={pending} className={buttonStyles({ size: 'sm', className: 'ml-1' })}>
            {pending ? 'Saving…' : 'Save result'}
          </button>
          <button
            type="button"
            onClick={() => setChoice(null)}
            disabled={pending}
            className={buttonStyles({ variant: 'quiet', size: 'sm' })}
          >
            Cancel
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="w-full text-sm text-loss">
          {error}
        </p>
      )}
    </div>
  );
}
