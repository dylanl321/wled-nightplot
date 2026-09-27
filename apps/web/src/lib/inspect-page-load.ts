import type { LightDetail, LightsPayload } from "@nightplot/shared";

export type InspectPageModel =
  | { kind: "server-down"; error?: string }
  | {
      kind: "ready";
      lights: LightsPayload;
      detail: LightDetail;
    }
  | {
      kind: "detail-miss";
      lights: LightsPayload;
      missing: boolean;
      error?: string;
    };

function settledMessage(result: PromiseSettledResult<unknown>): string | undefined {
  if (result.status !== "rejected") return undefined;
  return result.reason instanceof Error ? result.reason.message : "Unknown error";
}

function settledStatus(result: PromiseSettledResult<unknown>): number | undefined {
  if (result.status !== "rejected") return undefined;
  const reason = result.reason;
  if (reason && typeof reason === "object" && "status" in reason) {
    const status = (reason as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/** Lights failure is ServerDown. Detail-only failure keeps the enrolled list. */
export function inspectPageModel(
  lights: PromiseSettledResult<LightsPayload>,
  detail: PromiseSettledResult<LightDetail>,
): InspectPageModel {
  if (lights.status === "rejected") {
    return { kind: "server-down", error: settledMessage(lights) };
  }

  if (detail.status === "fulfilled") {
    return {
      kind: "ready",
      lights: lights.value,
      detail: detail.value,
    };
  }

  return {
    kind: "detail-miss",
    lights: lights.value,
    missing: settledStatus(detail) === 404,
    error: settledMessage(detail),
  };
}
