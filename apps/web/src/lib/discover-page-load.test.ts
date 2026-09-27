import type { DiscoverRow, LightsPayload } from "@nightplot/shared";
import { describe, expect, it } from "vitest";
import { discoverPageModel } from "@/lib/discover-page-load";
import { discoverRow, lightView } from "@/test/fixtures";

function lightsPayload(lights = [lightView()]): LightsPayload {
  return { lights, elements: [], unenrolled: [] };
}

function fulfilled<T>(value: T): PromiseFulfilledResult<T> {
  return { status: "fulfilled", value };
}

function rejected(message: string): PromiseRejectedResult {
  return { status: "rejected", reason: new Error(message) };
}

const session = { candidates: [discoverRow({ status: "found" })] satisfies DiscoverRow[] };

describe("discoverPageModel", () => {
  it("uses ServerDown when Lights fail even if Find answered", () => {
    const model = discoverPageModel(
      rejected("Lights list failed"),
      fulfilled(session),
    );
    expect(model).toEqual({
      kind: "server-down",
      error: "Lights list failed",
    });
  });

  it("uses ServerDown when both loads fail, naming the Lights error", () => {
    const model = discoverPageModel(
      rejected("Couldn’t reach the configure server"),
      rejected("Find session failed"),
    );
    expect(model.kind).toBe("server-down");
    if (model.kind !== "server-down") return;
    expect(model.error).toBe("Couldn’t reach the configure server");
  });

  it("keeps enrolled Lights when Find alone fails", () => {
    const lights = lightsPayload();
    const model = discoverPageModel(fulfilled(lights), rejected("Find session failed"));
    expect(model).toEqual({
      kind: "ready",
      lights,
      candidates: [],
      findError: "Find session failed",
    });
  });

  it("returns Find rows when both loads succeed", () => {
    const lights = lightsPayload();
    const model = discoverPageModel(fulfilled(lights), fulfilled(session));
    expect(model).toEqual({
      kind: "ready",
      lights,
      candidates: session.candidates,
    });
  });
});
