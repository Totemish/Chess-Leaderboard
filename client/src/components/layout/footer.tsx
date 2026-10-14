export default function Footer() {
  const link = 'underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-ink';
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap justify-between gap-x-8 gap-y-2 px-4 py-6 text-sm text-ink-faint">
        <p>
          Ratings come from the{' '}
          <a href="https://www.chess.com/news/view/published-data-api" className={link} target="_blank" rel="noreferrer">
            Chess.com public API
          </a>{' '}
          and sync every 10 minutes.
        </p>
        <a href="https://github.com/Totemish/IITR-Chess-Leaderboard" className={link} target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </div>
    </footer>
  );
}
