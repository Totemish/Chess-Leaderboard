'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { ChevronRight } from 'lucide-react';
import { describeError, fetchJson, sendJson } from '@/lib/api';
import { FORMATS, formatLabel, isRatingFormat } from '@/lib/chess';
import { cn } from '@/lib/utils';
import { useMe } from '@/hooks/use-me';
import { buttonStyles } from '@/components/ui/button';
import { EmptyMessage, ErrorMessage } from '@/components/ui/messages';
import type { ApiResponse, RatingFormat, TournamentStatus, TournamentSummary } from '@/types';

const GROUPS: { status: TournamentStatus; title: string }[] = [
  { status: 'ONGOING', title: 'In progress' },
  { status: 'PENDING', title: 'Open for registration' },
  { status: 'COMPLETED', title: 'Finished' },
];

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default function TournamentList() {
  const { isAdmin } = useMe();
  const { data, error, mutate } = useSWR<ApiResponse<TournamentSummary[]>>('/api/backend/tournaments', fetchJson);
  const [creating, setCreating] = useState(false);
  const tournaments = data?.data ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-8 pb-16 sm:pt-12">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight font-stretch-[118%] sm:text-5xl">Tournaments</h1>
          <p className="mt-3 max-w-prose text-ink-soft">
            Swiss-system events run by the IITR chess club. Register while an event is open; pairings are published one
            round at a time.
          </p>
        </div>
        {isAdmin && !creating && (
          <button type="button" onClick={() => setCreating(true)} className={buttonStyles()}>
            New tournament
          </button>
        )}
      </header>

      {isAdmin && creating && <CreateForm onCancel={() => setCreating(false)} />}

      <div className="mt-10 flex flex-col gap-10">
        {error ? (
          <ErrorMessage title="Couldn't load tournaments" detail={describeError(error)} onRetry={() => mutate()} />
        ) : !data ? (
          <div aria-label="Loading tournaments" className="h-48 animate-pulse rounded-lg bg-square-alt/60" />
        ) : tournaments.length === 0 ? (
          <EmptyMessage title="No tournaments yet">
            <p>
              {isAdmin
                ? 'Create the first one with New tournament. Players can register as soon as it exists.'
                : 'When a club admin opens registration for an event, it appears here.'}
            </p>
          </EmptyMessage>
        ) : (
          GROUPS.map(({ status, title }) => {
            const items = tournaments.filter((t) => t.status === status);
            if (items.length === 0) return null;
            return (
              <section key={status} aria-labelledby={`group-${status}`}>
                <h2 id={`group-${status}`} className="text-lg font-bold">
                  {title}
                </h2>
                <ul className="mt-3 overflow-hidden rounded-lg border border-line bg-surface">
                  {items.map((t) => (
                    <li key={t.id} className="border-b border-line last:border-b-0">
                      <Link
                        href={`/tournaments/${t.id}`}
                        className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-paper sm:px-5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-ink">{t.name}</span>
                          <span className="mt-0.5 flex flex-wrap gap-x-4 text-sm text-ink-faint">
                            <span>{isRatingFormat(t.format) ? formatLabel(t.format) : 'Rapid'}</span>
                            <span>
                              {t._count?.participants === 1 ? '1 player' : `${t._count?.participants ?? 0} players`}
                            </span>
                            <span>Created {dateFormat.format(new Date(t.createdAt))}</span>
                          </span>
                        </span>
                        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-faint" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

function CreateForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [format, setFormat] = useState<RatingFormat>('rapid');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const created = await sendJson<ApiResponse<TournamentSummary>>('/api/backend/tournaments', 'POST', {
        name: name.trim(),
        format,
      });
      router.push(`/tournaments/${created.data.id}`);
    } catch (err) {
      setError(describeError(err));
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 max-w-xl rounded-lg border border-line bg-surface p-5">
      <label htmlFor="tournament-name" className="text-sm font-semibold">
        Tournament name
      </label>
      <input
        id="tournament-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={80}
        autoComplete="off"
        placeholder="e.g. Autumn Rapid Swiss 2026"
        aria-invalid={!!error}
        aria-describedby={error ? 'create-error' : undefined}
        className="mt-1.5 h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint"
      />
      <fieldset className="mt-5">
        <legend className="text-sm font-semibold">Time control</legend>
        <p className="mt-0.5 text-sm text-ink-faint">Players are seeded by their Chess.com rating in this time control.</p>
        <div className="mt-2 flex gap-1">
          {FORMATS.map((f) => (
            <label
              key={f.id}
              className={cn(
                'cursor-pointer rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink',
                format === f.id ? 'border-ink bg-ink text-paper' : 'border-line-strong text-ink hover:bg-square-alt'
              )}
            >
              <input
                type="radio"
                name="format"
                value={f.id}
                checked={format === f.id}
                onChange={() => setFormat(f.id)}
                className="sr-only"
              />
              {f.label}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="mt-4 text-sm text-ink-faint">Registration opens as soon as the tournament is created.</p>
      {error && (
        <p id="create-error" role="alert" className="mt-2 text-sm text-loss">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending || !name.trim()} className={buttonStyles()}>
          {pending ? 'Creating…' : 'Create tournament'}
        </button>
        <button type="button" onClick={onCancel} className={buttonStyles({ variant: 'quiet' })}>
          Cancel
        </button>
      </div>
    </form>
  );
}
