'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { signIn, signOut, useSession } from 'next-auth/react';
import Avatar from '@/components/ui/avatar';
import { buttonStyles } from '@/components/ui/button';

export default function SignInButton() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // While open: Escape or a click elsewhere closes the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (status === 'loading') {
    return <span aria-hidden="true" className="block size-9 animate-pulse rounded-md bg-square-alt" />;
  }

  if (!session?.user) {
    return (
      <button type="button" onClick={() => signIn()} className={buttonStyles({ size: 'sm' })}>
        Sign in
      </button>
    );
  }

  const name = session.user.name || session.user.email || 'Your account';
  const item = 'block w-full rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-paper';

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={(e) => {
        // Tabbing out of the menu closes it.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="account-menu"
        className="flex items-center rounded-md p-0.5 hover:bg-square-alt"
      >
        <Avatar src={session.user.image} name={name} size={32} />
        <span className="sr-only">Account: {name}</span>
      </button>

      {open && (
        <div id="account-menu" className="absolute right-0 z-50 mt-2 w-64 rounded-lg border border-line bg-surface p-1 shadow-lg">
          <div className="mb-1 border-b border-line px-3 pt-2 pb-3">
            <p className="truncate text-sm font-semibold text-ink">{session.user.name}</p>
            {session.user.email && <p className="truncate text-xs text-ink-faint">{session.user.email}</p>}
          </div>
          <Link href="/dashboard" onClick={() => setOpen(false)} className={item}>
            Your dashboard
          </Link>
          <button type="button" onClick={() => signOut()} className={item}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
