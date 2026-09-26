export function apiUrl(path: string): string {
  if (typeof window === "undefined") {
    const base = process.env.NIGHTPLOT_API_URL ?? "http://127.0.0.1:43181";
    return `${base}${path}`;
  }
  return path;
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as T & {
    message?: string;
  };
  if (!res.ok) {
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }
  return body;
}

export type PlaceholderResponse = {
  error: string;
  action: string;
  slice: string;
  message: string;
};

export async function postPlaceholder(
  path: string,
): Promise<PlaceholderResponse> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as PlaceholderResponse;
  return {
    error: body.error ?? "not_implemented",
    action: body.action ?? path,
    slice: body.slice ?? "R0",
    message: body.message ?? "This action is not wired.",
  };
}
