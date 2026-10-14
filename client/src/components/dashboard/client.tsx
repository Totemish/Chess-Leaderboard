'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { signOut } from 'next-auth/react';
import { API_URL, describeError, fetchJson, sendJson } from '@/lib/api';
import {
  chessComUrl,
  competitionRanks,
  FORMATS,
  getRating,
  INSTITUTE_EMAIL_DOMAIN,
  ordinal,
  playerName,
} from '@/lib/chess';
import { cn } from '@/lib/utils';
import { useMe } from '@/hooks/use-me';
import Avatar from '@/components/ui/avatar';
import TitleBadge from '@/components/ui/title-badge';
import RatingChart from '@/components/charts/rating-chart';
import { buttonStyles } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/messages';
import type { ApiResponse, LeaderboardResponse, PlayerDetails, RatingFormat } from '@/types';

export default function DashboardClient() {
  const { session, me, isAdmin, error, isLoading, mutate } = useMe();
  const user = session?.user;

  if (error) {
    return (
      <Page>
        <ErrorMessage title="Couldn't load your account" detail={describeError(error)} onRetry={() => mutate()} />
      </Page>
    );
  }

  if (isLoading || !me || !user) {
    return (
      <Page>
        <div aria-label="Loading your dashboard" className="flex flex-col gap-6">
          <div className="h-14 w-72 animate-pulse rounded-md bg-square-alt" />
          <div className="h-40 animate-pulse rounded-lg bg-square-alt/60" />
        </div>
      </Page>
    );
  }

  const name = user.name || user.email || 'Your dashboard';

  return (
    <Page>
      <header className="flex items-center gap-4">
        <Avatar src={user.image} name={name} size={56} />
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-extrabold tracking-tight font-stretch-[118%] sm:text-4xl">{name}</h1>
          <p className="flex flex-wrap items-center gap-x-3 text-ink-soft">
            {user.email && <span className="truncate">{user.email}</span>}
            {isAdmin && (
              <span className="rounded-[3px] bg-ink px-1.5 text-xs leading-5 font-bold text-paper">Club admin</span>
            )}
          </p>
        </div>
      </header>

      {me.chessProfileId ? (
        <LinkedProfile username={me.chessProfileId} onUnlinked={() => mutate()} />
      ) : (
        <LinkForm email={user.email ?? null} emailVerified={session?.emailVerified === true} onLinked={() => mutate()} />
      )}
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-5xl px-4 pt-8 pb-16 sm:pt-12">{children}</div>;
}

interface Challenge {
  username: string;
  code: string;
}

/**
 * Linking takes two steps so nobody can claim someone else's account:
 * 1. The API checks the username exists and returns a code tied to this member.
 * 2. The member puts the code on their Chess.com profile; the API reads it back.
 */
function LinkForm({
  email,
  emailVerified,
  onLinked,
}: {
  email: string | null;
  emailVerified: boolean;
  onLinked: () => Promise<unknown>;
}) {
  const institute = !!email && email.toLowerCase().endsWith(INSTITUTE_EMAIL_DOMAIN);
  const eligible = institute && emailVerified;
  const [username, setUsername] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const signInAgain = () => signOut({ callbackUrl: '/auth/signin?callbackUrl=/dashboard' });

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await sendJson<ApiResponse<Challenge>>('/api/backend/auth/link-profile/challenge', 'POST', {
        chessUsername: username.trim(),
      });
      setChallenge(res.data);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  }

  async function verify() {
    if (!challenge) return;
    setPending(true);
    setError(null);
    try {
      await sendJson('/api/backend/auth/link-profile', 'POST', { chessUsername: challenge.username });
      await onLinked();
    } catch (err) {
      setError(describeError(err));
      setPending(false);
    }
  }

  async function copyCode() {
    if (!challenge) return;
    try {
      await navigator.clipboard.writeText(challenge.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (permissions, insecure origin); the code is still selectable.
    }
  }

  const link = 'font-semibold underline decoration-line-strong underline-offset-2 hover:decoration-ink';

  return (
    <section aria-labelledby="link-heading" className="mt-10 max-w-xl rounded-lg border border-line bg-surface p-6">
      <h2 id="link-heading" className="text-xl font-bold">
        {challenge ? `Confirm that ${challenge.username} is yours` : 'Link your Chess.com account'}
      </h2>

      {!challenge && (
        <p className="mt-2 text-sm text-ink-soft">
          Your ratings, rank and history come from Chess.com. Enter the username you play under to join the leaderboard
          and club tournaments.
        </p>
      )}

      {!institute && (
        <div className="mt-5 rounded-md border border-line-strong bg-paper px-4 py-3 text-sm text-ink">
          <p>
            Linking needs an <strong className="font-semibold">{INSTITUTE_EMAIL_DOMAIN}</strong> email.
            {email ? <> You&apos;re signed in as {email}.</> : <> This account didn&apos;t share an email address.</>}
          </p>
          <button type="button" onClick={signInAgain} className={cn('mt-2', link)}>
            Sign in with your institute account
          </button>
        </div>
      )}
      {institute && !emailVerified && (
        <div className="mt-5 rounded-md border border-line-strong bg-paper px-4 py-3 text-sm text-ink">
          <p>
            Your sign-in provider hasn&apos;t confirmed that {email} belongs to you. Sign in again, ideally with the Google
            account for your institute email.
          </p>
          <button type="button" onClick={signInAgain} className={cn('mt-2', link)}>
            Sign in again
          </button>
        </div>
      )}

      {challenge ? (
        <div className="mt-4">
          <p className="text-sm text-ink-soft">Add this code to your Chess.com profile, then come back:</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="rounded-md border border-line-strong bg-paper px-3 py-2 text-lg font-bold tracking-wider text-ink select-all">
              {challenge.code}
            </code>
            <button type="button" onClick={copyCode} className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
              {copied ? 'Copied' : 'Copy code'}
            </button>
          </div>
          <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-ink-soft">
            <li>
              Open your{' '}
              <a href="https://www.chess.com/settings" target="_blank" rel="noreferrer" className={link}>
                Chess.com profile settings
              </a>
              .
            </li>
            <li>Paste the code into the Location field and save.</li>
            <li>Press Verify below. You can remove the code once you&apos;re linked.</li>
          </ol>
          {error && (
            <p role="alert" className="mt-3 text-sm text-loss">
              {error}
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={verify} disabled={pending} className={buttonStyles()}>
              {pending ? 'Checking Chess.com…' : 'Verify and link'}
            </button>
            <button
              type="button"
              onClick={() => {
                setChallenge(null);
                setError(null);
              }}
              disabled={pending}
              className={buttonStyles({ variant: 'quiet' })}
            >
              Use a different username
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={requestCode} className="mt-6">
          <label htmlFor="chess-username" className="text-sm font-semibold">
            Chess.com username
          </label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input
              id="chess-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={!eligible || pending}
              required
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!!error}
              aria-describedby={error ? 'link-error' : undefined}
              placeholder="e.g. magnuscarlsen"
              className="h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint disabled:opacity-60"
            />
            <button type="submit" disabled={!eligible || pending || !username.trim()} className={buttonStyles()}>
              {pending ? 'Checking…' : 'Continue'}
            </button>
          </div>
          {error && (
            <p id="link-error" role="alert" className="mt-2 text-sm text-loss">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

function LinkedProfile({ username, onUnlinked }: { username: string; onUnlinked: () => Promise<unknown> }) {
  // The public player endpoint returns the full history; /auth/me only returns its oldest rows.
  const { data, error, mutate } = useSWR<ApiResponse<PlayerDetails>>(
    `${API_URL}/api/players/${encodeURIComponent(username)}`,
    fetchJson
  );
  const [format, setFormat] = useState<RatingFormat>('rapid');

  if (error) {
    return (
      <ErrorMessage
        className="mt-10"
        title="Couldn't load your Chess.com profile"
        detail={describeError(error)}
        onRetry={() => mutate()}
      />
    );
  }

  if (!data) {
    return <div aria-label="Loading your profile" className="mt-10 h-72 animate-pulse rounded-lg bg-square-alt/60" />;
  }

  const profile = data.data;

  return (
    <>
      <section className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-surface p-5">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar src={profile.avatarUrl} name={playerName(profile)} size={52} />
          <div className="min-w-0">
            <p className="flex items-center gap-2">
              <span className="truncate text-lg font-bold">{playerName(profile)}</span>
              <TitleBadge title={profile.title} />
            </p>
            <a
              href={chessComUrl(profile.username)}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-ink"
            >
              @{profile.username} on Chess.com
            </a>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <RefreshControl username={profile.username} onRefreshed={() => mutate()} />
          <UnlinkControl onUnlinked={onUnlinked} />
        </div>
      </section>

      <section aria-labelledby="ratings-heading" className="mt-8">
        <h2 id="ratings-heading" className="text-sm font-semibold text-ink-soft">
          Ratings and club rank
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
          {FORMATS.map((f) => (
            <RatingTile
              key={f.id}
              format={f.id}
              label={f.label}
              rating={getRating(profile, f.id)}
              profileId={profile.id}
              selected={format === f.id}
              onSelect={() => setFormat(f.id)}
            />
          ))}
        </div>
      </section>

      <section aria-label="Rating history" className="mt-8 rounded-lg border border-line bg-surface p-5">
        <RatingChart
          histories={profile.ratingHistories}
          format={format}
          current={getRating(profile, format)}
          height={260}
        />
      </section>
    </>
  );
}

/** One time control's rating, the player's place on the club board, and a chart toggle. */
function RatingTile({
  format,
  label,
  rating,
  profileId,
  selected,
  onSelect,
}: {
  format: RatingFormat;
  label: string;
  rating: number | null;
  profileId: string;
  selected: boolean;
  onSelect: () => void;
}) {
  // Same URL as the leaderboard's first page, so SWR shares the cache between the two.
  const { data } = useSWR<LeaderboardResponse>(rating === null ? null : `${API_URL}/api/leaderboard/${format}`, fetchJson);

  let standing = 'No rating yet';
  if (rating !== null && data) {
    const players = data.data;
    const index = players.findIndex((p) => p.id === profileId);
    const total = data.nextCursor ? `${players.length}+` : String(players.length);
    standing =
      index === -1
        ? `Outside the top ${players.length}`
        : `${ordinal(competitionRanks(players.map((p) => getRating(p, format)))[index])} of ${total} at IITR`;
  } else if (rating !== null) {
    standing = 'Finding your rank…';
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex flex-col items-start border-b-[3px] bg-surface px-5 pt-4 pb-[13px] text-left transition-colors hover:bg-paper',
        selected ? 'border-ink' : 'border-transparent'
      )}
    >
      <span className="text-sm font-semibold text-ink-soft">{label}</span>
      <span className="mt-1 text-4xl font-extrabold tracking-tight">{rating ?? '–'}</span>
      <span className="mt-1 text-sm text-ink-faint">{standing}</span>
    </button>
  );
}

/** Pulls fresh ratings from Chess.com now instead of waiting for the next scheduled sync. */
function RefreshControl({ username, onRefreshed }: { username: string; onRefreshed: () => Promise<unknown> }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  async function refresh() {
    setPending(true);
    setMessage(null);
    try {
      await sendJson(`/api/backend/auth/sync/${encodeURIComponent(username)}`, 'POST');
      await onRefreshed();
      setMessage({ error: false, text: 'Ratings updated from Chess.com.' });
    } catch (err) {
      setMessage({ error: true, text: describeError(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex max-w-56 flex-col gap-1">
      <button type="button" onClick={refresh} disabled={pending} className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
        {pending ? 'Refreshing…' : 'Refresh ratings'}
      </button>
      {message && (
        <p role="status" className={cn('text-xs', message.error ? 'text-loss' : 'text-ink-soft')}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function UnlinkControl({ onUnlinked }: { onUnlinked: () => Promise<unknown> }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // The button that opened the confirmation disappears, so move focus to the safe choice.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  async function unlink() {
    setPending(true);
    setError(null);
    try {
      await sendJson('/api/backend/auth/unlink-profile', 'DELETE');
      await onUnlinked();
    } catch (err) {
      setError(describeError(err));
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={buttonStyles({ variant: 'quiet', size: 'sm' })}>
        Unlink account
      </button>
    );
  }

  return (
    <div role="group" aria-label="Confirm unlinking" className="flex max-w-sm flex-col gap-2">
      <p className="text-sm text-ink-soft">
        Unlink this Chess.com account from your sign-in? Its ratings stay on the leaderboard.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={unlink} disabled={pending} className={buttonStyles({ variant: 'danger', size: 'sm' })}>
          {pending ? 'Unlinking…' : 'Unlink'}
        </button>
        <button
          ref={cancelRef}
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className={buttonStyles({ variant: 'quiet', size: 'sm' })}
        >
          Keep it linked
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      )}
    </div>
  );
}
