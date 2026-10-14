'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/leaderboard/rapid', label: 'Leaderboard', match: '/leaderboard' },
  { href: '/tournaments', label: 'Tournaments', match: '/tournaments' },
  { href: '/dashboard', label: 'Dashboard', match: '/dashboard' },
];

export default function NavLinks() {
  const pathname = usePathname() ?? '';

  return (
    <nav
      aria-label="Main"
      className="order-last -mx-2 flex w-full items-center sm:order-none sm:mx-0 sm:w-auto"
    >
      {LINKS.map(({ href, label, match }) => {
        const active = pathname === match || pathname.startsWith(`${match}/`);

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'border-b-2 px-2 py-3 text-sm font-semibold transition-colors sm:px-3',
              active
                ? 'border-ink text-ink'
                : 'border-transparent text-ink-soft hover:text-ink'
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
