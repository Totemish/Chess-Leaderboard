import Link from 'next/link';
import SignInButton from '../auth/sign-in-button';
import NavLinks from './nav-links';

export default function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-8 px-4">
        <Link href="/" className="flex items-center gap-2.5 py-3 text-lg font-black tracking-tight font-stretch-[118%]">
          <BoardMark />
          IITR Chess
        </Link>

        <NavLinks />

        <div className="ml-auto py-2">
          <SignInButton />
        </div>
      </div>
    </header>
  );
}

// A two-by-two corner of a chessboard.
function BoardMark() {
  return (
    <span
      aria-hidden="true"
      className="grid size-6 grid-cols-2 grid-rows-2 overflow-hidden rounded-[5px] border border-ink"
    >
      <span className="bg-ink" />
      <span className="bg-paper" />
      <span className="bg-paper" />
      <span className="bg-ink" />
    </span>
  );
}
