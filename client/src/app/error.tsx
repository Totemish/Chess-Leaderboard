'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { buttonStyles } from '@/components/ui/button';

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-16 pb-20">
      <h1 className="text-4xl font-extrabold tracking-tight font-stretch-[118%]">This page hit an error</h1>
      <p className="mt-3 max-w-prose text-ink-soft">
        Something failed while loading it. Try again; if it keeps happening, the ratings server may be down.
      </p>
      <div className="mt-6 flex gap-3">
        <button type="button" onClick={() => retry()} className={buttonStyles()}>
          Try again
        </button>
        <Link href="/leaderboard/rapid" className={buttonStyles({ variant: 'quiet' })}>
          Go to the leaderboard
        </Link>
      </div>
    </div>
  );
}
