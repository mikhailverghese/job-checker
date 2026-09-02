'use client';

import { useEffect, useState } from 'react';

/**
 * Ticking "now" used to render live relative timestamps.
 * Returns null until mounted so SSR and hydration agree.
 */
export function useNow(intervalMs = 30000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function renderRelativeTime(isoString: string | undefined, now: number) {
  if (!isoString) return 'n/a';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'n/a';
  const diffMs = now - date.getTime();
  if (diffMs < 0) return 'just now';
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function RelativeTime({ iso, now, className }: { iso?: string; now: number | null; className?: string }) {
  return <span className={className || undefined}>{now ? renderRelativeTime(iso, now) : '—'}</span>;
}
