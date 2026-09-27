import type { LightsPayload } from "@nightplot/shared";
import { describe, expect, it } from "vitest";
import { inspectPageModel } from "@/lib/inspect-page-load";
import { lightDetail, lightView } from "@/test/fixtures";

function lightsPayload(lights = [lightView()]): LightsPayload {
  return { lights, elements: [], unenrolled: [] };
}

function fulfilled<T>(value: T): PromiseFulfilledResult<T> {
  return { status: "fulfilled", value };
}

function rejected(message: string, status?: number): PromiseRejectedResult {
  const reason = new Error(message) as Error & { status?: number };
  if (status !== undefined) reason.status = status;
  return { status: "rejected", reason };
}

const detail = lightDetail();

describe("inspectPageModel", () => {
  it("uses ServerDown when Lights fail even if detail answered", () => {
    const model = inspectPageModel(rejected("Lights list failed"), fulfilled(detail));
    expect(model).toEqual({
      kind: "server-down",
      error: "Lights list failed",
    });
  });

  it("uses ServerDown when both loads fail, naming the Lights error", () => {
    const model = inspectPageModel(
      rejected("Couldn’t reach the configure server"),
      rejected("This Light failed", 500),
    );
    expect(model.kind).toBe("server-down");
    if (model.kind !== "server-down") return;
    expect(model.error).toBe("Couldn’t reach the configure server");
  });

  it("keeps enrolled Lights when detail alone fails", () => {
    const lights = lightsPayload();
    const model = inspectPageModel(fulfilled(lights), rejected("This Light failed", 500));
    expect(model).toEqual({
      kind: "detail-miss",
      lights,
      missing: false,
      error: "This Light failed",
    });
  });

  it("keeps enrolled Lights when this Light is not on Lights", () => {
    const lights = lightsPayload();
    const model = inspectPageModel(
      fulfilled(lights),
      rejected("That Light is not on Lights", 404),
    );
    expect(model).toEqual({
      kind: "detail-miss",
      lights,
      missing: true,
      error: "That Light is not on Lights",
    });
  });

  it("returns Inspect when both loads succeed", () => {
    const lights = lightsPayload();
    const model = inspectPageModel(fulfilled(lights), fulfilled(detail));
    expect(model).toEqual({
      kind: "ready",
      lights,
      detail,
    });
  });
});
