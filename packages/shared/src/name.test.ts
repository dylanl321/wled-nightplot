import { describe, expect, it } from "vitest";
import { resolveLightName } from "./name.ts";

describe("resolveLightName", () => {
  it("prefers a fresh cfg name when /json/info still lags", () => {
    expect(
      resolveLightName({
        infoName: "WLED",
        cfgName: "Porch rail",
      }),
    ).toEqual({
      name: "Porch rail",
      nameSource: "cfg",
      staleInfoName: "WLED",
      infoLagging: true,
    });
  });

  it("treats matching info and cfg as caught up", () => {
    expect(
      resolveLightName({
        infoName: "Porch rail",
        cfgName: "Porch rail",
      }),
    ).toEqual({
      name: "Porch rail",
      nameSource: "info",
      staleInfoName: null,
      infoLagging: false,
    });
  });

  it("keeps a stored cfg name while info still reports the stale value", () => {
    expect(
      resolveLightName({
        infoName: "WLED",
        existing: { name: "Porch rail", nameSource: "cfg", staleInfoName: "WLED" },
      }),
    ).toEqual({
      name: "Porch rail",
      nameSource: "cfg",
      staleInfoName: "WLED",
      infoLagging: true,
    });
  });

  it("clears the lag when /json/info catches up after reboot", () => {
    expect(
      resolveLightName({
        infoName: "Porch rail",
        existing: { name: "Porch rail", nameSource: "cfg", staleInfoName: "WLED" },
      }),
    ).toEqual({
      name: "Porch rail",
      nameSource: "info",
      staleInfoName: null,
      infoLagging: false,
    });
  });

  it("trusts /json/info when it moves off the recorded stale name", () => {
    expect(
      resolveLightName({
        infoName: "Kitchen",
        existing: { name: "Porch rail", nameSource: "cfg", staleInfoName: "WLED" },
      }),
    ).toEqual({
      name: "Kitchen",
      nameSource: "info",
      staleInfoName: null,
      infoLagging: false,
    });
  });

  it("uses the snapshot name when nothing was written through cfg", () => {
    expect(resolveLightName({ infoName: "WLED-7F2A" })).toEqual({
      name: "WLED-7F2A",
      nameSource: "info",
      staleInfoName: null,
      infoLagging: false,
    });
  });
});
