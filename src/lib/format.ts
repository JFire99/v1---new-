export function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}

export function formatVolume(volume: number): string {
  if (volume >= 1_000_000_000) return `${(volume / 1_000_000_000).toFixed(2)}B`;
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(2)}M`;
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(1)}K`;
  return volume.toFixed(0);
}

export function formatPct(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatRelVol(rvol: number): string {
  return `${rvol.toFixed(2)}x`;
}

export function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    'minute': '2-digit',
    'second': '2-digit',
    hour12: false,
  });
}

export function formatTimeShort(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    'minute': '2-digit',
    hour12: false,
  });
}

export function getMomentumColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 70) return 'text-green-400';
  if (score >= 60) return 'text-yellow-400';
  if (score >= 40) return 'text-orange-400';
  return 'text-red-400';
}

export function getMomentumBg(score: number): string {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 70) return 'bg-green-500';
  if (score >= 60) return 'bg-yellow-500';
  if (score >= 40) return 'bg-orange-500';
  return 'bg-red-500';
}

export function getChangeColor(pct: number): string {
  if (pct > 0.01) return 'text-emerald-400';
  if (pct < -0.01) return 'text-red-400';
  return 'text-gray-400';
}
