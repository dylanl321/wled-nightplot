import { describe, expect, it, vi } from "vitest";
import {
  createWledConfigExportReader,
  createWledLedmapReader,
  createWledLedmapWriter,
  createWledNativeFilesReader,
  createWledNativeFilesWriter,
  ledmapFileName,
} from "./native-backup.ts";

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

  it("uploads presets then configuration to /upload using the native filenames", async () => {
    const calls: { url: string; filename: string }[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      const file = form.get("data") as File;
      calls.push({ url, filename: file.name });
      return new Response(url.includes("cfg") ? "Rebooting..." : "File Uploaded!");
    });
    await createWledNativeFilesWriter(fetchFn as unknown as typeof fetch)(
      { hostname: "192.168.1.20", port: 8080 },
      { cfgJson: '{"id":{}}', presetsJson: '{"1":{}}' },
    );
    expect(calls).toEqual([
      { url: "http://192.168.1.20:8080/upload", filename: "presets.json" },
      { url: "http://192.168.1.20:8080/upload", filename: "cfg.json" },
    ]);
  });

  it("names a light map file by its number, 0 to 9, and refuses any other number", () => {
    expect(ledmapFileName()).toBe("ledmap.json");
    expect(ledmapFileName(0)).toBe("ledmap.json");
    expect(ledmapFileName(1)).toBe("ledmap1.json");
    expect(ledmapFileName(9)).toBe("ledmap9.json");
    for (const bad of [-1, 10, 1.5, Number.NaN]) expect(() => ledmapFileName(bad)).toThrow(/maps 0 to 9/);
  });

  it("reads and uploads each light map under its own file name", async () => {
    const urls: string[] = [];
    const names: string[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        names.push(((init.body as FormData).get("data") as File).name);
        return new Response("File Uploaded!");
      }
      urls.push(url);
      return url.endsWith("ledmap2.json") ? new Response("nope", { status: 404 }) : new Response('{"map":[0]}');
    });
    const target = { hostname: "192.168.1.20", port: 8080 };
    const write = createWledLedmapWriter(fetchFn as unknown as typeof fetch);
    await write(target, '{"map":[0]}');
    await write(target, '{"map":[0]}', 3);
    expect(names).toEqual(["ledmap.json", "ledmap3.json"]);
    const read = createWledLedmapReader(fetchFn as unknown as typeof fetch);
    expect(await read(target)).toBe('{"map":[0]}');
    expect(await read(target, 1)).toBe('{"map":[0]}');
    expect(await read(target, 2)).toBeNull();
    expect(urls).toEqual([
      "http://192.168.1.20:8080/ledmap.json",
      "http://192.168.1.20:8080/ledmap1.json",
      "http://192.168.1.20:8080/ledmap2.json",
    ]);
    await expect(write(target, "{}", 10)).rejects.toThrow(/maps 0 to 9/);
  });
});
