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
    const error = new Error(body.message ?? `Request failed (${res.status})`) as Error & {
      status: number;
    };
    error.status = res.status;
    throw error;
  }
  return body;
}

export type ApiFail = {
  error?: string;
  message?: string;
};

export async function postJson<T>(
  path: string,
  body?: unknown,
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; data: ApiFail }> {
  return sendJson<T>(path, "POST", body);
}

export async function patchJson<T>(
  path: string,
  body?: unknown,
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; data: ApiFail }> {
  return sendJson<T>(path, "PATCH", body);
}

export async function deleteJson<T>(
  path: string,
  body?: unknown,
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; data: ApiFail }> {
  return sendJson<T>(path, "DELETE", body);
}

async function sendJson<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; data: ApiFail }> {
  const res = await fetch(apiUrl(path), {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & ApiFail;
  if (!res.ok) return { ok: false, status: res.status, data };
  return { ok: true, status: res.status, data };
}
