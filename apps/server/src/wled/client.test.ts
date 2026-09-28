import { describe, expect, it } from "vitest";
import {
  PROBE_STATE_AFTER_INFO_MS,
  probeFailedReason,
  probeWled,
} from "./client.ts";

const wledInfo = {
  ver: "0.15.4",
  name: "WLED-7F2A",
  mac: "e89f6d7f2a04",
  brand: "WLED",
  leds: { count: 60, rgbw: false },
};

const wledState = {
  on: true,
  bri: 128,
  seg: [{ start: 0, stop: 60, col: [[255, 160, 0]] }],
};

function hangingFetch(): typeof fetch {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("missing abort"));
        return;
      }
      if (signal.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      signal.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    });
}

function jsonOk(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

function jsonMiss(): Response {
  return { ok: false, json: async () => ({}) } as Response;
}

describe("probeFailedReason", () => {
  it("uses generic copy when the refuse was instant", () => {
    expect(probeFailedReason("192.168.1.90", 0)).toBe("probe failed.");
    expect(probeFailedReason("192.168.1.90", 12)).toBe("probe failed.");
    expect(probeFailedReason("192.168.1.90", 499)).toBe("probe failed.");
  });

  it("uses actual elapsed seconds when the wait was meaningful", () => {
    expect(probeFailedReason("192.168.1.90", 500)).toBe(
      "192.168.1.90 didn’t return a snapshot in 1 s.",
    );
    expect(probeFailedReason("192.168.1.90", 2800)).toBe(
      "192.168.1.90 didn’t return a snapshot in 3 s.",
    );
    expect(probeFailedReason("192.168.1.90", 6200)).toBe(
      "192.168.1.90 didn’t return a snapshot in 6 s.",
    );
  });

  it("never claims a timeout budget the probe did not wait", () => {
    expect(probeFailedReason("192.168.1.90", 8)).not.toMatch(/in 3 s/);
  });
});

describe("probeWled probe-failed copy", () => {
  it("names an unreachable API process without claiming that WLED answered", async () => {
    const outcome = await probeWled(
      { hostname: "10.0.1.31", port: 80 },
      async () => { throw new Error("fetch failed", { cause: Object.assign(new Error("no route"), { code: "EHOSTUNREACH" }) }); },
    );
    expect(outcome).toEqual({
      kind: "probe-failed",
      reason: "The API process cannot reach 10.0.1.31 on this network. Check the LAN route and, on macOS, Local Network access for the app running Nightplot. Nothing was added.",
    });
  });
  it("does not say in 3 s when fetch refuses immediately", async () => {
    const started = Date.now();
    const outcome = await probeWled(
      { hostname: "192.168.1.90", port: 80 },
      async () => {
        throw new Error("ECONNREFUSED");
      },
    );
    expect(Date.now() - started).toBeLessThan(400);
    expect(outcome).toEqual({ kind: "probe-failed", reason: "probe failed." });
  });

  it("names the wait when both snapshot paths abort", async () => {
    const outcome = await probeWled(
      { hostname: "192.168.1.90", port: 80 },
      hangingFetch(),
      600,
    );
    expect(outcome.kind).toBe("probe-failed");
    if (outcome.kind !== "probe-failed") return;
    expect(outcome.reason).toMatch(
      /^192\.168\.1\.90 didn’t return a snapshot in [12] s\.$/,
    );
    expect(outcome.reason).not.toMatch(/in 3 s/);
  });
});

describe("probeWled /json/state after /json/info", () => {
  it("does not wait a full abort budget when state hangs after info", async () => {
    const hang = hangingFetch();
    const fetchFn: typeof fetch = (url, init) => {
      const path = String(url);
      if (path.endsWith("/json/info")) return Promise.resolve(jsonOk(wledInfo));
      if (path.endsWith("/json/state")) return hang(url, init);
      return Promise.resolve(jsonMiss());
    };
    const started = Date.now();
    const outcome = await probeWled(
      { hostname: "192.168.1.90", port: 80 },
      fetchFn,
      1500,
    );
    const elapsed = Date.now() - started;
    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") return;
    expect(outcome.snapshot.name).toBe("WLED-7F2A");
    expect(outcome.snapshot.on).toBeNull();
    expect(outcome.snapshot.segments).toBeNull();
    expect(elapsed).toBeLessThan(PROBE_STATE_AFTER_INFO_MS + 250);
    expect(elapsed).toBeLessThan(1500);
  });

  it("skips state when the ~3 s budget is already spent", async () => {
    const hang = hangingFetch();
    const fetchFn: typeof fetch = (url, init) => {
      const path = String(url);
      if (path.endsWith("/json/info")) return Promise.resolve(jsonOk(wledInfo));
      if (path.endsWith("/json/state")) return hang(url, init);
      return hang(url, init);
    };
    const started = Date.now();
    const outcome = await probeWled(
      { hostname: "192.168.1.90", port: 80 },
      fetchFn,
      400,
    );
    const elapsed = Date.now() - started;
    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") return;
    expect(outcome.snapshot.on).toBeNull();
    expect(outcome.snapshot.segments).toBeNull();
    expect(elapsed).toBeLessThan(700);
  });

  it("still uses a fast /json/state after info", async () => {
    const fetchFn: typeof fetch = async (url) => {
      const path = String(url);
      if (path.endsWith("/json/info")) return jsonOk(wledInfo);
      if (path.endsWith("/json/state")) return jsonOk(wledState);
      return jsonMiss();
    };
    const outcome = await probeWled(
      { hostname: "192.168.1.90", port: 80 },
      fetchFn,
      1500,
    );
    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") return;
    expect(outcome.snapshot.on).toBe(true);
    expect(outcome.snapshot.brightness).toBe(128);
    expect(outcome.snapshot.segments).toEqual([{ start: 0, stop: 60 }]);
  });

  it("does not wait on /json/state when info is not WLED", async () => {
    const hang = hangingFetch();
    const fetchFn: typeof fetch = (url, init) => {
      const path = String(url);
      if (path.endsWith("/json/info")) {
        return Promise.resolve(jsonOk({ ok: true, server: "nginx" }));
      }
      if (path.endsWith("/json/state")) return hang(url, init);
      return Promise.resolve(jsonMiss());
    };
    const started = Date.now();
    const outcome = await probeWled(
      { hostname: "192.168.1.90", port: 80 },
      fetchFn,
      1500,
    );
    expect(Date.now() - started).toBeLessThan(400);
    expect(outcome).toEqual({
      kind: "not-wled",
      reason: "Answered, but /json/info isn’t WLED. Not added.",
    });
  });
});
