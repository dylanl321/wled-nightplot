/** Loopback web origins. Extra published origins come from NIGHTPLOT_CORS_ORIGINS. */
export const DEFAULT_CORS_ORIGINS = [
  "http://127.0.0.1:43180",
  "http://localhost:43180",
] as const;

function extraOriginAllowed(value: string): boolean {
  if (value === "*" || value.includes("*")) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    if (url.pathname !== "/" || url.search || url.hash) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Fail-closed CORS allowlist.
 * Defaults stay loopback web. `NIGHTPLOT_CORS_ORIGINS` is a comma-separated
 * add-on (http(s) origins only). `*` and wildcards are ignored.
 */
export function resolveCorsOrigins(
  raw = process.env.NIGHTPLOT_CORS_ORIGINS,
): string[] {
  const extras = (raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(extraOriginAllowed);
  return [...new Set([...DEFAULT_CORS_ORIGINS, ...extras])];
}
