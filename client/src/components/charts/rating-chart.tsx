'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type DotItemDotProps,
  type TooltipContentProps,
} from 'recharts';
import { cn } from '@/lib/utils';
import { formatLabel } from '@/lib/chess';
import type { RatingFormat, RatingHistory } from '@/types';

interface Point {
  t: number;
  rating: number;
}

const DAY = 86_400_000;

// History rows are stamped at UTC midnight, so format them as UTC calendar days.
const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fullDayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * One format's rating points from the last `days` days, oldest first. When the
 * live rating is known, today's point is set to it, so the line always ends at
 * the number shown beside the chart (history is stored once per UTC day).
 */
export function recentPoints(
  histories: RatingHistory[],
  format: RatingFormat,
  days = 90,
  current: number | null = null
): Point[] {
  const since = Date.now() - days * DAY;
  const points = histories
    .filter((h) => h.format === format)
    .map((h) => ({ t: Date.parse(h.date), rating: h.rating }))
    .filter((p) => p.t >= since)
    .sort((a, b) => a.t - b.t);

  if (current !== null) {
    const today = Math.floor(Date.now() / DAY) * DAY;
    const last = points[points.length - 1];
    if (last && last.t >= today) last.rating = current;
    else points.push({ t: today, rating: current });
  }
  return points;
}

/** Round-numbered y ticks (steps of 5, 10, 25, 50, …) that bracket the data. */
function ratingTicks(points: Point[]): number[] {
  let lo = Math.min(...points.map((p) => p.rating));
  let hi = Math.max(...points.map((p) => p.rating));
  if (hi - lo < 20) {
    lo -= 10;
    hi += 10;
  }
  const raw = (hi - lo) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step; v += step) ticks.push(v);
  return ticks;
}

/** First, last and up to three evenly spaced dates in between. */
function dateTicks(points: Point[]): number[] {
  const first = points[0].t;
  const last = points[points.length - 1].t;
  const spanDays = Math.round((last - first) / DAY);
  const segments = Math.min(4, spanDays);
  return Array.from({ length: segments + 1 }, (_, i) => first + Math.round((spanDays * i) / segments) * DAY);
}

function ChartTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as Point | undefined;
  if (!active || !point) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 shadow-sm">
      <p className="flex items-center gap-2 text-sm font-bold text-ink tabular-nums">
        <span aria-hidden="true" className="h-0.5 w-3 rounded-full bg-plot" />
        {point.rating}
      </p>
      <p className="text-xs text-ink-faint">{fullDayFormat.format(point.t)}</p>
    </div>
  );
}

export default function RatingChart({
  histories,
  format,
  current = null,
  days = 90,
  height = 220,
  className,
}: {
  histories: RatingHistory[];
  format: RatingFormat;
  /** The live rating, if known; it replaces today's stored point. */
  current?: number | null;
  days?: number;
  height?: number;
  className?: string;
}) {
  const points = recentPoints(histories, format, days, current);
  const label = formatLabel(format);

  if (points.length < 2) {
    return (
      <div className={cn('flex flex-col justify-center rounded-md bg-paper px-4 py-6', className)} style={{ minHeight: height }}>
        <p className="font-semibold text-ink">Not enough history yet</p>
        <p className="mt-1 max-w-prose text-sm text-ink-soft">
          {points.length === 0
            ? `No ${label.toLowerCase()} games recorded in the last ${days} days.`
            : `The ${label.toLowerCase()} rating is recorded once a day. The chart appears after the second day.`}
        </p>
      </div>
    );
  }

  const first = points[0];
  const last = points[points.length - 1];
  const change = last.rating - first.rating;
  const yTicks = ratingTicks(points);
  const lastIndex = points.length - 1;

  const renderDot = (props: DotItemDotProps) => {
    const { cx, cy, index } = props;
    if (index !== lastIndex || cx == null || cy == null) return <g key={index} />;
    return (
      <g key={index}>
        <circle cx={cx} cy={cy} r={4} fill="var(--plot)" stroke="var(--surface)" strokeWidth={2} />
        <text x={cx - 8} y={cy - 10} textAnchor="end" className="fill-ink text-xs font-bold tabular-nums">
          {last.rating}
        </text>
      </g>
    );
  };

  return (
    <figure className={className}>
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-semibold text-ink">
          {label} rating, last {days} days
        </span>
        <span className="text-sm text-ink-soft">
          <span className={cn('font-bold tabular-nums', change > 0 && 'text-gain', change < 0 && 'text-loss')}>
            {change > 0 ? `+${change}` : change < 0 ? `−${Math.abs(change)}` : '±0'}
          </span>{' '}
          since {dayFormat.format(first.t)}
        </span>
      </figcaption>

      <div
        role="img"
        aria-label={`${label} rating from ${first.rating} on ${fullDayFormat.format(first.t)} to ${last.rating} on ${fullDayFormat.format(last.t)}.`}
        style={{ height }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 22, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeWidth={1} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              ticks={dateTicks(points)}
              tickFormatter={(t: number) => dayFormat.format(t)}
              tick={{ fill: 'var(--ink-faint)', fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--line-strong)' }}
              tickMargin={8}
            />
            <YAxis
              domain={[yTicks[0], yTicks[yTicks.length - 1]]}
              ticks={yTicks}
              tick={{ fill: 'var(--ink-faint)', fontSize: 12, className: 'tabular-nums' }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              content={ChartTooltip}
              cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="rating"
              stroke="var(--plot)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              dot={renderDot}
              activeDot={{ r: 5, fill: 'var(--plot)', stroke: 'var(--surface)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <details className="mt-2 text-sm">
        <summary className="w-fit cursor-pointer rounded text-ink-soft hover:text-ink">Show as table</summary>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-line">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface text-ink-soft">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-semibold">Date</th>
                <th scope="col" className="px-3 py-1.5 text-right font-semibold">Rating</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.t} className="border-t border-line">
                  <td className="px-3 py-1.5 text-ink-soft">{fullDayFormat.format(p.t)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{p.rating}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
