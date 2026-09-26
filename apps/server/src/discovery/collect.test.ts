import { describe, expect, it } from "vitest";
import { parseTargetList } from "./collect.ts";

describe("parseTargetList", () => {
  it("keeps an explicit non-80 fixture port", () => {
    expect(parseTargetList("127.0.0.1:48210")).toEqual([
      { hostname: "127.0.0.1", port: 48210, via: "targets" },
    ]);
  });

  it("typed host without a port still means :80 — that default is documented", () => {
    expect(parseTargetList("192.168.1.72")).toEqual([
      { hostname: "192.168.1.72", port: 80, via: "targets" },
    ]);
  });
});
