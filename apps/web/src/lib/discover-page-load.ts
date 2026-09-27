import type { DiscoverRow, LightsPayload } from "@nightplot/shared";

export type DiscoverPageModel =
  | { kind: "server-down"; error?: string }
  | {
      kind: "ready";
      lights: LightsPayload;
      candidates: DiscoverRow[];
      findError?: string;
    };

function settledMessage(result: PromiseSettledResult<unknown>): string | undefined {
  if (result.status !== "rejected") return undefined;
  return result.reason instanceof Error ? result.reason.message : "Unknown error";
}

/** Lights failure is ServerDown. Find-only failure keeps the enrolled list. */
export function discoverPageModel(
  lights: PromiseSettledResult<LightsPayload>,
  discover: PromiseSettledResult<{ candidates: DiscoverRow[] }>,
): DiscoverPageModel {
  if (lights.status === "rejected") {
    return { kind: "server-down", error: settledMessage(lights) };
  }

  if (discover.status === "fulfilled") {
    return {
      kind: "ready",
      lights: lights.value,
      candidates: discover.value.candidates ?? [],
    };
  }

  return {
    kind: "ready",
    lights: lights.value,
    candidates: [],
    findError: settledMessage(discover),
  };
}
