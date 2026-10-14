'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

// Chess.com's grey placeholder; the backend stores it when a player has no photo.
const CHESS_COM_PLACEHOLDER = 'https://www.chess.com/bundles/web/images/user-image.svg';

/**
 * Square avatar with an initial-letter fallback for missing or broken images.
 * Avatars come from several hosts (Chess.com, Google, GitHub, Discord) at
 * 32–64px, so a plain <img> avoids routing them through the image optimizer.
 */
export default function Avatar({
  src,
  name,
  size = 40,
  className,
}: {
  src: string | null | undefined;
  name: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const usable = src && src !== CHESS_COM_PLACEHOLDER && !failed;

  if (!usable) {
    return (
      <span
        aria-hidden="true"
        style={{ width: size, height: size, fontSize: size * 0.42 }}
        className={cn(
          'grid shrink-0 place-items-center rounded-md bg-square-alt font-bold text-ink-soft select-none',
          className
        )}
      >
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className={cn('shrink-0 rounded-md bg-square-alt object-cover', className)}
    />
  );
}
