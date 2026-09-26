export function lastSeenLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return "last seen unknown";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "last seen unknown";
  const delta = Math.max(0, now - then);
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "last seen just now";
  if (minutes < 60) return `last seen ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `last seen ${hours} h ago`;
  const days = Math.round(hours / 24);
  return `last seen ${days} d ago`;
}

export function brightnessPct(bri: number | null): number | null {
  if (bri === null) return null;
  return Math.round((bri / 255) * 100);
}

export function snapshotLabel(iso: string | null, now = Date.now()): string {
  return lastSeenLabel(iso, now).replace(/^last seen/, "Snapshot");
}
