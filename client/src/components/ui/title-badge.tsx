const TITLE_NAMES: Record<string, string> = {
  GM: 'Grandmaster',
  IM: 'International Master',
  FM: 'FIDE Master',
  CM: 'Candidate Master',
  NM: 'National Master',
  WGM: 'Woman Grandmaster',
  WIM: 'Woman International Master',
  WFM: 'Woman FIDE Master',
  WCM: 'Woman Candidate Master',
  WNM: 'Woman National Master',
};

/** A chess title (GM, IM, …) the way Chess.com prints it beside a name. */
export default function TitleBadge({ title }: { title: string | null | undefined }) {
  if (!title) return null;
  return (
    <abbr
      title={TITLE_NAMES[title] ?? title}
      className="shrink-0 rounded-[3px] bg-square px-1 py-px text-[11px] leading-4 font-bold tracking-wide text-on-square no-underline"
    >
      {title}
    </abbr>
  );
}
