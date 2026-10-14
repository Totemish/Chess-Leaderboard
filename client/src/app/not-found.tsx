import Link from 'next/link';
import { buttonStyles } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-16 pb-20">
      <h1 className="text-4xl font-extrabold tracking-tight font-stretch-[118%]">Page not found</h1>
      <p className="mt-3 max-w-prose text-ink-soft">
        There&apos;s no page at this address. Check the link, or head back to the rankings.
      </p>
      <Link href="/leaderboard/rapid" className={buttonStyles({ className: 'mt-6' })}>
        Go to the leaderboard
      </Link>
    </div>
  );
}
