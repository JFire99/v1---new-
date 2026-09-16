export function getRecency(createdAt: string): { label: string; className: string; ageText: string } {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(ageMs / 60000);
  const secs = Math.floor((ageMs % 60000) / 1000);

  let ageText = '';
  if (mins < 1) {
    ageText = `${Math.max(0, secs)}s ago`;
  } else if (mins < 60) {
    ageText = `${mins}m ago`;
  } else {
    const hours = Math.floor(mins / 60);
    ageText = `${hours}h ago`;
  }

  // BREAKING: 0-5 mins
  if (mins < 5) {
    return { label: 'BREAKING', className: 'recency-breaking', ageText };
  }
  // RECENT: 5-30 mins
  if (mins < 30) {
    return { label: 'RECENT', className: 'recency-recent', ageText };
  }
  // OLDER: 30-120 mins
  if (mins < 120) {
    return { label: 'OLDER', className: 'recency-older', ageText };
  }
  // ARCHIVED: > 2h
  return { label: 'ARCHIVED', className: 'recency-archived', ageText };
}

export function formatTimeET(isoString: string): string {
  try {
    const d = new Date(isoString);
    return (
      d.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }) + ' ET'
    );
  } catch {
    return '';
  }
}
