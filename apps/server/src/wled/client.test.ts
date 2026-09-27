import { describe, expect, it } from "vitest";
import { probeFailedReason, probeWled } from "./client.ts";

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
    const hang: typeof fetch = (_url, init) =>
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
    const outcome = await probeWled(
      { hostname: "192.168.1.90", port: 80 },
      hang,
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
