import { formatScore, playerName } from '@/lib/chess';
import { buildCrosstable, type CrosstableCell } from '@/lib/tournament';
import { cn } from '@/lib/utils';
import { squareTone } from '@/components/ui/square';
import type { Match, Participant } from '@/types';

const SIGN: Record<'win' | 'draw' | 'loss', string> = { win: '+', draw: '=', loss: '−' };
const SPOKEN: Record<CrosstableCell['outcome'], string> = {
  win: 'won against',
  draw: 'drew with',
  loss: 'lost to',
  pending: 'playing',
  bye: 'bye',
};

function Cell({ cell }: { cell: CrosstableCell | null }) {
  if (!cell) {
    return (
      <>
        <span aria-hidden="true" className="text-ink-faint">–</span>
        <span className="sr-only">not paired</span>
      </>
    );
  }
  if (cell.outcome === 'bye') return <span className="text-ink-faint">bye</span>;

  const opponent = cell.opponentPlace ?? '?';
  const visible = cell.outcome === 'pending' ? String(opponent) : `${SIGN[cell.outcome]}${opponent}`;
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          cell.outcome === 'win' && 'font-bold text-ink',
          cell.outcome === 'draw' && 'text-ink-soft',
          (cell.outcome === 'loss' || cell.outcome === 'pending') && 'text-ink-faint'
        )}
      >
        {visible}
      </span>
      <span className="sr-only">
        {SPOKEN[cell.outcome]} {opponent}
      </span>
    </>
  );
}

/**
 * Standings as a chess crosstable: one row per player, one column per round.
 * Before round 1 it doubles as the list of registered players.
 */
export default function Crosstable({
  participants,
  matches,
  myProfileId,
}: {
  participants: Participant[];
  matches: Match[];
  myProfileId: string | null;
}) {
  const { rounds, rows } = buildCrosstable(participants, matches);

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            {rounds.length > 0
              ? 'Standings. Each round shows the result and the opponent’s place: plus for a win, equals for a draw, minus for a loss.'
              : 'Registered players, by rating.'}
          </caption>
          <thead>
            <tr className="border-b border-line text-left text-ink-soft">
              <th scope="col" className="sticky left-0 z-10 bg-surface py-2 pr-3 pl-0 font-semibold">
                <span className="inline-block w-12 text-center sm:w-14">#</span>
                Player
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Rating
              </th>
              {rounds.map((r) => (
                <th key={r} scope="col" className="px-2 py-2 text-center font-semibold">
                  <abbr title={`Round ${r}`} className="no-underline">
                    R{r}
                  </abbr>
                </th>
              ))}
              {rounds.length > 0 && (
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  Points
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ place, participant, cells }) => {
              const isYou = participant.profileId === myProfileId;
              // Opaque, because the sticky name cell must hide columns scrolling beneath it.
              const rowTint = isYou ? 'bg-[color-mix(in_oklab,var(--marker)_28%,var(--surface))]' : 'bg-surface';
              return (
                <tr key={participant.id} className={cn('border-b border-line last:border-b-0', rowTint)}>
                  <th scope="row" className={cn('sticky left-0 z-10 p-0 text-left font-normal', rowTint)}>
                    <span className="flex items-center">
                      <span
                        className={cn(
                          'grid h-11 w-12 shrink-0 place-items-center font-bold tabular-nums sm:w-14',
                          squareTone(place)
                        )}
                      >
                        {place}
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5 py-2 pr-3 pl-3 whitespace-nowrap">
                        <span className="max-w-[11rem] truncate font-semibold text-ink sm:max-w-[16rem]">
                          {playerName(participant.profile)}
                        </span>
                        {isYou && (
                          <span className="rounded-[3px] bg-marker px-1 py-px text-[11px] font-bold text-on-marker">You</span>
                        )}
                      </span>
                    </span>
                  </th>
                  <td className="px-3 py-2 text-right text-ink-soft tabular-nums">{participant.seedRating || '–'}</td>
                  {cells.map((cell, i) => (
                    <td key={rounds[i]} className="px-2 py-2 text-center tabular-nums">
                      <Cell cell={cell} />
                    </td>
                  ))}
                  {rounds.length > 0 && (
                    <td className="px-4 py-2 text-right font-bold text-ink tabular-nums">{formatScore(participant.score)}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rounds.length > 0 && (
        <p className="mt-2 text-sm text-ink-faint">
          Round columns show the opponent&apos;s place: + win, = draw, − loss. Rating is the rating each player
          joined with.
        </p>
      )}
    </>
  );
}
