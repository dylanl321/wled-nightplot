import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it } from "vitest";
import { collectBonjour, parseBonjourAddress, parseBonjourZone, runDnsSd } from "./bonjour.ts";

const zone = `Browsing for _wled._tcp.local
_wled._tcp PTR wled-123._wled._tcp
wled-123._wled._tcp SRV 0 0 8088 wled-123.local. ; Replace with unicast FQDN of target host
Other._http._tcp SRV 0 0 80 other.local. ; ignored
wled-456._wled._tcp SRV 0 0 80 wled-456.local. ; Replace with unicast FQDN of target host
wled-123._wled._tcp SRV 0 0 8088 wled-123.local. ; repeated
`;
const addresses = `DATE: ---Mon---
Timestamp     A/R  Flags         IF  Hostname Address TTL
19:28:54.148  Add  40000002      14  wled-123.local. 10.0.1.31 120
`;

describe("macOS Bonjour Find", () => {
  it("uses only WLED SRV targets and their advertised ports", () => {
    expect(parseBonjourZone(zone)).toEqual([
      { target: "wled-123.local", port: 8088 },
      { target: "wled-456.local", port: 80 },
    ]);
    expect(parseBonjourZone("Other._http._tcp SRV 0 0 80 other.local.\n")).toEqual([]);
    expect(parseBonjourZone("wled-123._wled._tcp SRV 0 0 0 wled-123.local.\n")).toEqual([
      { target: "wled-123.local", port: null },
    ]);
  });

  it("accepts an Add for the requested target, not an unrelated or removed address", () => {
    expect(parseBonjourAddress(addresses, "wled-123.local")).toBe("10.0.1.31");
    expect(parseBonjourAddress(addresses, "wled-456.local")).toBeNull();
    expect(parseBonjourAddress(addresses.replace(" Add ", " Rmv "), "wled-123.local")).toBeNull();
  });

  it("collects IPv4 hosts for the existing WLED probe, leaving unresolved services out", async () => {
    const calls: string[][] = [];
    const rows = await collectBonjour(10, async (args) => {
      calls.push(args);
      return args[0] === "-Z" ? zone : args[2] === "wled-123.local" ? addresses : "";
    });
    expect(calls).toEqual([
      ["-Z", "_wled._tcp", "local"],
      ["-G", "v4", "wled-123.local"],
      ["-G", "v4", "wled-456.local"],
    ]);
    expect(rows).toEqual([{ hostname: "10.0.1.31", port: 8088, via: "mdns" }]);
  });

  it("terminates the streaming DNS-SD child at the deadline", async () => {
    const child = new EventEmitter() as ChildProcessWithoutNullStreams;
    const stdout = new PassThrough();
    Object.assign(child, { stdout, exitCode: null });
    let signal = "";
    child.kill = ((next: string) => { signal = next; return true; }) as typeof child.kill;
    const result = runDnsSd(["-Z", "_wled._tcp", "local"], 100, () => child);
    stdout.write(zone);
    expect(await result).toBe(zone);
    expect(signal).toBe("SIGTERM");
  });
});
