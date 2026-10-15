'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR, { mutate as globalMutate } from 'swr';
import { Check, ChevronLeft } from 'lucide-react';
import { API_URL, ApiError, describeError, fetchJson, sendJson } from '@/lib/api';
import { boardOrder, isBye, roundsOf, scoresBeforeRound, statusText } from '@/lib/tournament';
import { formatLabel, getRating, isRatingFormat, playerName } from '@/lib/chess';
import { cn } from '@/lib/utils';
import { useMe } from '@/hooks/use-me';
import { buttonStyles } from '@/components/ui/button';
import { EmptyMessage, ErrorMessage } from '@/components/ui/messages';
import Pairings from './pairings';
import Crosstable from './crosstable';
import type { ApiResponse, ChessProfile, Participant, RatingFormat, TournamentDetails } from '@/types';

export default function TournamentDetail({ id }: { id: string }) {
  const { me, isAdmin } = useMe();
  const { data, error, mutate } = useSWR<ApiResponse<TournamentDetails>>(
    `/api/backend/tournaments/${encodeURIComponent(id)}`,
    fetchJson
  );
  const [selectedRound, setSelectedRound] = useState<number | null>(null);

  if (error) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <Page>
        {missing ? (
          <EmptyMessage title="Tournament not found">
            <p>It may have been removed, or the link is wrong.</p>
          </EmptyMessage>
        ) : (
          <ErrorMessage title="Couldn't load this tournament" detail={describeError(error)} onRetry={() => mutate()} />
        )}
      </Page>
    );
  }

  if (!data) {
    return (
      <Page>
        <div aria-label="Loading tournament" className="flex flex-col gap-6">
          <div className="h-12 w-2/3 animate-pulse rounded-md bg-square-alt" />
          <div className="h-64 animate-pulse rounded-lg bg-square-alt/60" />
        </div>
      </Page>
    );
  }

  const t = data.data;
  const rounds = roundsOf(t.matches);
  const latest = rounds[rounds.length - 1] ?? 0;
  const shownRound = selectedRound ?? latest;
  const seedOf = new Map(t.participants.map((p) => [p.profileId, p.seedRating]));
  const shownMatches = boardOrder(
    t.matches.filter((m) => m.round === shownRound),
    t.matches,
    seedOf
  );
  const unfinished = t.matches.filter((m) => m.round === latest && m.status === 'PENDING' && !isBye(m)).length;
  const myProfileId = me?.chessProfileId ?? null;
  const joined = !!myProfileId && t.participants.some((p) => p.profileId === myProfileId);
  const players = t.participants.length;
  // Admins build the field until round 1 is paired; then it's locked.
  const editingField = isAdmin && t.status === 'PENDING';
  const format: RatingFormat = isRatingFormat(t.format) ? t.format : 'rapid';

  const pairingsSection = (
    <section key="pairings" aria-labelledby="pairings-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 id="pairings-heading" className="text-xl font-bold">
          {rounds.length > 0 ? `Round ${shownRound} pairings` : 'Pairings'}
        </h2>
        {rounds.length > 1 && <RoundPicker rounds={rounds} active={shownRound} onSelect={setSelectedRound} />}
      </div>
      {rounds.length === 0 ? (
        <EmptyMessage title="Round 1 hasn't been paired yet">
          <p>Pairings appear here once an admin pairs round 1.</p>
        </EmptyMessage>
      ) : (
        <Pairings
          tournamentId={t.id}
          matches={shownMatches}
          scoreBefore={scoresBeforeRound(t.matches, shownRound)}
          myProfileId={myProfileId}
          canRecord={isAdmin}
          canChange={t.status === 'ONGOING' && shownRound === latest}
          onRecorded={() => mutate()}
        />
      )}
    </section>
  );

  const standingsSection = (
    <section key="standings" aria-labelledby="standings-heading">
      <h2 id="standings-heading" className="mb-4 text-xl font-bold">
        {rounds.length > 0 ? (t.status === 'COMPLETED' ? 'Final standings' : 'Standings') : 'Registered players'}
      </h2>
      {editingField && (
        <AddPlayerControl
          tournamentId={t.id}
          format={format}
          registered={new Set(t.participants.map((p) => p.profileId))}
          onAdded={() => mutate()}
        />
      )}
      {players === 0 ? (
        <EmptyMessage title="No players yet">
          <p>
            {editingField
              ? 'Add players from the list above. You can change the list until round 1 is paired.'
              : 'A club admin adds the players before round 1 is paired.'}
          </p>
        </EmptyMessage>
      ) : (
        <Crosstable
          participants={t.participants}
          matches={t.matches}
          myProfileId={myProfileId}
          renderAction={
            editingField
              ? (participant) => (
                  <RemovePlayerButton tournamentId={t.id} participant={participant} onRemoved={() => mutate()} />
                )
              : undefined
          }
        />
      )}
    </section>
  );

  // During an event people come for their next game; afterwards, for the results.
  const sections = t.status === 'COMPLETED' ? [standingsSection, pairingsSection] : [pairingsSection, standingsSection];

  return (
    <Page>
      <Link
        href="/tournaments"
        className="inline-flex items-center gap-1 rounded text-sm font-semibold text-ink-soft hover:text-ink"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        All tournaments
      </Link>

      <header className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold tracking-tight break-words font-stretch-[118%] sm:text-5xl">{t.name}</h1>
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-ink-soft">
            <span className="font-semibold text-ink">{statusText(t.status, latest)}</span>
            <span>{players === 1 ? '1 player' : `${players} players`}</span>
            <span>{isRatingFormat(t.format) ? formatLabel(t.format) : 'Rapid'}</span>
            <span>Swiss system</span>
          </p>
        </div>

        <div className="flex flex-col items-start gap-3 sm:items-end">
          {t.status === 'PENDING' && joined && (
            <p className="inline-flex items-center gap-2 font-semibold text-ink">
              <Check aria-hidden="true" className="size-4 text-gain" />
              You&apos;re registered
            </p>
          )}
          {isAdmin && t.status !== 'COMPLETED' && (
            <PairRoundControl
              tournamentId={t.id}
              nextRound={latest + 1}
              unfinished={unfinished}
              players={players}
              onPaired={async () => {
                setSelectedRound(null);
                await mutate();
              }}
            />
          )}
          {isAdmin && t.status === 'ONGOING' && unfinished === 0 && (
            <FinishControl tournamentId={t.id} rounds={latest} onFinished={() => mutate()} />
          )}
        </div>
      </header>

      <div className="mt-10 flex flex-col gap-12">{sections}</div>

      {isAdmin && <DeleteControl tournamentId={t.id} name={t.name} />}
    </Page>
  );
}

/** Kept at the bottom of the page, away from the everyday admin actions. */
function DeleteControl({ tournamentId, name }: { tournamentId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await sendJson(`/api/backend/tournaments/${tournamentId}`, 'DELETE');
      await globalMutate('/api/backend/tournaments');
      router.push('/tournaments');
    } catch (err) {
      setError(describeError(err));
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="delete-heading" className="mt-16 border-t border-line pt-6">
      <h2 id="delete-heading" className="sr-only">
        Delete tournament
      </h2>
      {confirming ? (
        <div role="group" aria-label="Confirm deleting the tournament" className="flex max-w-xl flex-col gap-3">
          <p className="text-sm text-ink">
            Delete <strong className="font-semibold">{name}</strong>? Its registrations, pairings and results are removed
            for good. Players stay on the leaderboard.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={remove} disabled={pending} className={buttonStyles({ variant: 'danger' })}>
              {pending ? 'Deleting…' : 'Delete tournament'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className={buttonStyles({ variant: 'quiet' })}
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={buttonStyles({ variant: 'danger', size: 'sm' })}>
          Delete tournament
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-loss">
          {error}
        </p>
      )}
    </section>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-16 sm:pt-10">{children}</div>;
}

function FinishControl({
  tournamentId,
  rounds,
  onFinished,
}: {
  tournamentId: string;
  rounds: number;
  onFinished: () => Promise<unknown>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    setPending(true);
    setError(null);
    try {
      await sendJson(`/api/backend/tournaments/${tournamentId}/finish`, 'POST');
      await onFinished();
    } catch (err) {
      setError(describeError(err));
      setPending(false);
    }
  }

  return (
    <div className="flex max-w-xs flex-col items-start gap-2 sm:items-end sm:text-right">
      {confirming ? (
        <>
          <p className="text-sm text-ink-soft">
            Finish after {rounds} {rounds === 1 ? 'round' : 'rounds'}? The standings become final and no more rounds can be
            paired.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={finish} disabled={pending} className={buttonStyles()}>
              {pending ? 'Finishing…' : 'Finish tournament'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className={buttonStyles({ variant: 'quiet' })}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={buttonStyles({ variant: 'quiet' })}>
          Finish tournament
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      )}
    </div>
  );
}

function RoundPicker({
  rounds,
  active,
  onSelect,
}: {
  rounds: number[];
  active: number;
  onSelect: (round: number) => void;
}) {
  return (
    <div role="group" aria-label="Choose a round" className="flex flex-wrap gap-1">
      {rounds.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onSelect(r)}
          aria-pressed={r === active}
          aria-label={`Round ${r}`}
          className={cn(
            'grid size-9 place-items-center rounded-md text-sm font-bold tabular-nums transition-colors',
            r === active ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-square-alt hover:text-ink'
          )}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

/** "Name (username), rating", or just "username, rating" when the two match. */
function playerOption(profile: ChessProfile, format: RatingFormat): string {
  const name = playerName(profile);
  const who = name.toLowerCase() === profile.username.toLowerCase() ? profile.username : `${name} (${profile.username})`;
  return `${who}, ${getRating(profile, format) ?? 'unrated'}`;
}

/** Admins pick the field from everyone on the leaderboard, one player at a time. */
function AddPlayerControl({
  tournamentId,
  format,
  registered,
  onAdded,
}: {
  tournamentId: string;
  format: RatingFormat;
  registered: Set<string>;
  onAdded: () => Promise<unknown>;
}) {
  const { data, error: loadError } = useSWR<ApiResponse<ChessProfile[]>>(`${API_URL}/api/players`, fetchJson);
  const [selected, setSelected] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = (data?.data ?? [])
    .filter((p) => !registered.has(p.id))
    .sort((a, b) => playerName(a).localeCompare(playerName(b)));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      await sendJson(`/api/backend/tournaments/${tournamentId}/players`, 'POST', { username: selected });
      setSelected('');
      await onAdded();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  }

  const placeholder = !data ? 'Loading players…' : available.length === 0 ? 'Everyone on the leaderboard is in' : 'Choose a player';

  return (
    <form onSubmit={add} className="mb-4 rounded-lg border border-line bg-surface p-4">
      <label htmlFor="add-player" className="text-sm font-semibold">
        Add a player from the leaderboard
      </label>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
        <select
          id="add-player"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={!data || pending || available.length === 0}
          className="h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink disabled:opacity-60"
        >
          <option value="">{placeholder}</option>
          {available.map((p) => (
            <option key={p.id} value={p.username}>
              {playerOption(p, format)}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!selected || pending} className={buttonStyles()}>
          {pending ? 'Adding…' : 'Add player'}
        </button>
      </div>
      {(error || loadError) && (
        <p role="alert" className="mt-2 text-sm text-loss">
          {error ?? describeError(loadError)}
        </p>
      )}
    </form>
  );
}

function RemovePlayerButton({
  tournamentId,
  participant,
  onRemoved,
}: {
  tournamentId: string;
  participant: Participant;
  onRemoved: () => Promise<unknown>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = playerName(participant.profile);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await sendJson(`/api/backend/tournaments/${tournamentId}/players/${encodeURIComponent(participant.profileId)}`, 'DELETE');
      await onRemoved();
    } catch (err) {
      setError(describeError(err));
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        aria-label={`Remove ${name}`}
        className={buttonStyles({ variant: 'quiet', size: 'sm' })}
      >
        {pending ? 'Removing…' : 'Remove'}
      </button>
      {error && (
        <span role="alert" className="text-xs whitespace-normal text-loss">
          {error}
        </span>
      )}
    </span>
  );
}

function PairRoundControl({
  tournamentId,
  nextRound,
  unfinished,
  players,
  onPaired,
}: {
  tournamentId: string;
  nextRound: number;
  unfinished: number;
  players: number;
  onPaired: () => Promise<unknown>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The API enforces these too; checking here explains why the button is disabled.
  const blocker =
    players < 2
      ? 'Add at least 2 players before pairing round 1.'
      : unfinished > 0
        ? `Enter the ${unfinished === 1 ? 'last result' : `remaining ${unfinished} results`} of round ${nextRound - 1} first.`
        : null;
  // Pairing round by round can't always finish a near all-play-all cleanly: in
  // simulations, problems only appeared past players − 2 rounds.
  const crowded = nextRound > 1 && nextRound > players - 2;

  async function pair() {
    setPending(true);
    setError(null);
    try {
      await sendJson(`/api/backend/tournaments/${tournamentId}/generate-round`, 'POST');
      setConfirming(false);
      await onPaired();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex max-w-xs flex-col items-start gap-2 sm:items-end sm:text-right">
      {confirming ? (
        <>
          <p className="text-sm text-ink-soft">
            {nextRound === 1
              ? 'Pair round 1? The player list locks once it’s paired.'
              : `Pair round ${nextRound} from the current standings?`}
            {crowded &&
              ` With ${players} players, a rematch or a repeated colour may be unavoidable from this round on.`}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={pair} disabled={pending} className={buttonStyles()}>
              {pending ? 'Pairing…' : `Pair round ${nextRound}`}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className={buttonStyles({ variant: 'quiet' })}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={!!blocker}
          aria-describedby={blocker ? 'pair-blocker' : undefined}
          className={buttonStyles({ variant: 'secondary' })}
        >
          Pair round {nextRound}
        </button>
      )}
      {blocker && !confirming && (
        <p id="pair-blocker" className="text-sm text-ink-faint">
          {blocker}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      )}
    </div>
  );
}
