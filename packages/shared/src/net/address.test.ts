import { describe, expect, it } from "vitest";
import {
  decideProbeAddress,
  displayHost,
  isLanAllowed,
  normalizeHostKey,
  parseHostPort,
} from "./address.ts";

describe("parseHostPort", () => {
  it("defaults to port 80", () => {
    expect(parseHostPort("192.168.1.72")).toEqual({
      hostname: "192.168.1.72",
      port: 80,
    });
  });

  it("keeps an explicit port and strips a scheme", () => {
    expect(parseHostPort("192.168.1.80:80")).toEqual({
      hostname: "192.168.1.80",
      port: 80,
    });
    expect(parseHostPort("http://wled.local:81")).toEqual({
      hostname: "wled.local",
      port: 81,
    });
  });
});

describe("LAN guard", () => {
  it("allows RFC1918, loopback, link-local, and .local names", () => {
    expect(isLanAllowed("192.168.1.72")).toBe(true);
    expect(isLanAllowed("10.0.0.4")).toBe(true);
    expect(isLanAllowed("172.16.1.2")).toBe(true);
    expect(isLanAllowed("127.0.0.1")).toBe(true);
    expect(isLanAllowed("localhost")).toBe(true);
    expect(isLanAllowed("wled.local")).toBe(true);
    expect(isLanAllowed("wled-kitchen")).toBe(true);
  });

  it("refuses public and documentation addresses before any probe", () => {
    expect(isLanAllowed("203.0.113.9")).toBe(false);
    expect(isLanAllowed("8.8.8.8")).toBe(false);
    expect(isLanAllowed("1.1.1.1")).toBe(false);
    expect(isLanAllowed("example.com")).toBe(false);
    const decision = decideProbeAddress("203.0.113.9");
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reasonCode).toBe("disallowed-address");
      expect(decision.reason).toMatch(/Refused before probing/);
    }
  });
});

describe("host keys", () => {
  it("treats implicit and explicit port 80 as the same Light", () => {
    const a = parseHostPort("192.168.1.72");
    const b = parseHostPort("192.168.1.72:80");
    expect(a && b && normalizeHostKey(a)).toBe(normalizeHostKey(b!));
    expect(displayHost({ hostname: "192.168.1.72", port: 80 })).toBe(
      "192.168.1.72",
    );
  });
});
