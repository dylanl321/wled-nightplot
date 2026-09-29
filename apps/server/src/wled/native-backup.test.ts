import { describe, expect, it, vi } from "vitest";
import { createWledConfigExportReader, createWledNativeFilesReader } from "./native-backup.ts";

describe("WLED native backup", () => {
  it("reads one fresh cfg.json without touching presets or sending a write", async () => {
    const fetchFn = vi.fn(async (_url: string) => new Response('{"id":{"name":"Porch"}}'));
    expect(await createWledConfigExportReader(fetchFn as unknown as typeof fetch)(
      { hostname: "192.168.1.20", port: 8080 })).toBe('{"id":{"name":"Porch"}}');
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe("http://192.168.1.20:8080/cfg.json");
    await expect(createWledConfigExportReader(async () => new Response("<html>"))(
      { hostname: "example.local", port: 80 })).rejects.toThrow();
  });
  it("fetches both native files byte-for-byte from the advertised port", async () => {
    const fetchFn = vi.fn(async (url: string) =>
      new Response(url.endsWith("cfg.json") ? '{ "name": "Porch" }\n' : '{"1":{"n":"Warm"}}'));
    const files = await createWledNativeFilesReader(fetchFn as unknown as typeof fetch)(
      { hostname: "192.168.1.20", port: 8080 });
    expect(files).toEqual({ cfgJson: '{ "name": "Porch" }\n', presetsJson: '{"1":{"n":"Warm"}}' });
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      "http://192.168.1.20:8080/cfg.json", "http://192.168.1.20:8080/presets.json",
    ]);
  });

  it("refuses an HTML error or a missing second file", async () => {
    const html = createWledNativeFilesReader(async () => new Response("<html>Login</html>"));
    await expect(html({ hostname: "example.local", port: 80 })).rejects.toThrow();
    const fetchFn = vi.fn(async (url: string) => new Response(
      url.endsWith("cfg.json") ? "{}" : "not found", { status: url.endsWith("cfg.json") ? 200 : 404 }));
    await expect(createWledNativeFilesReader(fetchFn as unknown as typeof fetch)(
      { hostname: "example.local", port: 80 })).rejects.toThrow("presets.json returned HTTP 404");
  });
});
