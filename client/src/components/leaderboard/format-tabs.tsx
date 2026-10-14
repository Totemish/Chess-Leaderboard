import Link from 'next/link';
import { cn } from '@/lib/utils';
import { FORMATS } from '@/lib/chess';
import type { RatingFormat } from '@/types';

/** The time-control switcher doubles as the page headline. */
export default function FormatTabs({ active }: { active: RatingFormat }) {
  return (
    <nav aria-label="Time control">
      <ul className="flex flex-wrap items-end gap-x-6 gap-y-2 sm:gap-x-9">
        {FORMATS.map(({ id, label }) => {
          const current = id === active;
          return (
            <li key={id}>
              <Link
                href={`/leaderboard/${id}`}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'block border-b-4 pb-1 text-[2rem] leading-none font-extrabold tracking-tight font-stretch-[118%] transition-colors sm:text-5xl',
                  current ? 'border-ink text-ink' : 'border-transparent text-line-strong hover:text-ink-soft'
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
