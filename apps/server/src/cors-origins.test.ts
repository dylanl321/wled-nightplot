import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CORS_ORIGINS, resolveCorsOrigins } from "./cors-origins.ts";

describe("resolveCorsOrigins", () => {
  afterEach(() => {
    delete process.env.NIGHTPLOT_CORS_ORIGINS;
  });

  it("defaults to loopback web only", () => {
    expect(resolveCorsOrigins(undefined)).toEqual([...DEFAULT_CORS_ORIGINS]);
    expect(resolveCorsOrigins("")).toEqual([...DEFAULT_CORS_ORIGINS]);
    expect(resolveCorsOrigins("   ")).toEqual([...DEFAULT_CORS_ORIGINS]);
  });

  it("adds a published http origin from env", () => {
    expect(resolveCorsOrigins("http://192.168.1.10:43180")).toEqual([
      ...DEFAULT_CORS_ORIGINS,
      "http://192.168.1.10:43180",
    ]);
  });

  it("ignores star, wildcards, and junk (fail-closed)", () => {
    expect(
      resolveCorsOrigins("*, http://evil.com/path, not-a-url, https://ok.example"),
    ).toEqual([...DEFAULT_CORS_ORIGINS, "https://ok.example"]);
  });
});
