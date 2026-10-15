// The footer stays on the dark squares in light mode too (`.on-dark`, globals.css).
export default function Footer() {
  return (
    <footer className="on-dark border-t border-line bg-paper">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-4 py-6">
        <p className="group flex items-center gap-2 text-ink-soft">
          Made with
          <PixelHeart />
          <span className="sr-only">love</span>
          by
          <span className="text-lg font-black tracking-tight text-ink font-stretch-[125%]">Avneesh</span>
        </p>
        <a
          href="https://github.com/Totemish/Chess-Leaderboard"
          className="text-sm text-ink-faint underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-ink"
          target="_blank"
          rel="noreferrer"
        >
          Source on GitHub
        </a>
      </div>
    </footer>
  );
}

const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];

// A heart set on a grid of board squares, shaded in a checker like the board itself.
// It beats once when the signature is hovered.
function PixelHeart() {
  return (
    <svg
      aria-hidden="true"
      width="21"
      height="18"
      viewBox="0 0 7 6"
      shapeRendering="crispEdges"
      className="inline-block shrink-0 fill-loss group-hover:animate-heartbeat"
    >
      {HEART.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === '#' ? (
            <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" fillOpacity={(x + y) % 2 === 0 ? 1 : 0.72} />
          ) : null
        )
      )}
    </svg>
  );
}
