import { describe, expect, it } from "vitest";
import {
  extractSsdpLocation,
  parseLocationUrl,
  parseSsdpAdvertisement,
  resolveMdnsRecords,
  validPort,
} from "./parse.ts";

const fixtureLocation = [
  "HTTP/1.1 200 OK",
  "CACHE-CONTROL: max-age=1800",
  "EXT:",
  "LOCATION: http://127.0.0.1:48210/description.xml",
  "SERVER: Arduino/1.0 UPNP/1.1 WLED/0.15.4",
  "ST: urn:schemas-upnp-org:device:wled:1",
  "USN: uuid:wled-fixture",
  "",
  "",
].join("\r\n");

describe("validPort", () => {
  it("accepts 1–65535 and rejects 0 / fallback-shaped values", () => {
    expect(validPort(80)).toBe(80);
    expect(validPort(48210)).toBe(48210);
    expect(validPort("21324")).toBe(21324);
    expect(validPort(0)).toBeNull();
    expect(validPort(undefined)).toBeNull();
    expect(validPort(70000)).toBeNull();
  });
});

describe("LOCATION", () => {
  it("reads an explicit non-80 port from a WLED-shaped reply", () => {
    expect(extractSsdpLocation(fixtureLocation)).toBe(
      "http://127.0.0.1:48210/description.xml",
    );
    expect(parseSsdpAdvertisement(fixtureLocation, "192.168.1.9")).toEqual({
      hostname: "127.0.0.1",
      port: 48210,
    });
  });

  it("keeps an explicit :80 from LOCATION — that is advertised, not guessed", () => {
    expect(
      parseSsdpAdvertisement(
        "HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.72:80/\r\n\r\n",
        "192.168.1.72",
      ),
    ).toEqual({ hostname: "192.168.1.72", port: 80 });
  });

  it("uses the URL default :80 when LOCATION is http without a port", () => {
    expect(parseLocationUrl("http://192.168.1.72/description.xml")).toEqual({
      hostname: "192.168.1.72",
      port: 80,
    });
  });

  it("leaves port unset when LOCATION is missing — do not use rinfo:80", () => {
    expect(
      parseSsdpAdvertisement(
        "HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:wled:1\r\n\r\n",
        "192.168.1.50",
      ),
    ).toEqual({ hostname: "192.168.1.50", port: null });
  });

  it("parses IPv6 LOCATION with a non-80 port", () => {
    expect(parseLocationUrl("http://[fd00::1]:21324/")).toEqual({
      hostname: "fd00::1",
      port: 21324,
    });
  });
});

describe("mDNS records", () => {
  it("uses the SRV port on a matching A record — including non-80", () => {
    expect(
      resolveMdnsRecords([
        {
          name: "wled-kitchen._wled._tcp.local",
          type: "SRV",
          data: { target: "wled-kitchen.local.", port: 48210 },
        },
        {
          name: "wled-kitchen.local",
          type: "A",
          data: "192.168.1.72",
        },
      ]),
    ).toEqual([{ hostname: "192.168.1.72", port: 48210 }]);
  });

  it("does not turn data.port || 80 into a silent default", () => {
    expect(
      resolveMdnsRecords([
        {
          name: "wled._wled._tcp.local",
          type: "SRV",
          data: { target: "wled.local", port: 0 },
        },
      ]),
    ).toEqual([{ hostname: "wled.local", port: null }]);
  });

  it("ignores other services and bare addresses on the same link", () => {
    expect(
      resolveMdnsRecords([
        {
          name: "desk._http._tcp.local",
          type: "SRV",
          data: { target: "desk.local", port: 3100 },
        },
        { name: "desk.local", type: "A", data: "10.0.3.241" },
        { name: "desk.local", type: "AAAA", data: "fe80::205:cdff:fef2:32a0" },
        { name: "wled.local", type: "A", data: "10.0.0.20" },
        {
          name: "Dig-Quad-V3._wled._tcp.local",
          type: "SRV",
          data: { target: "Dig-Quad-V3.local", port: 80 },
        },
        { name: "Dig-Quad-V3.local", type: "A", data: "10.0.0.85" },
      ]),
    ).toEqual([{ hostname: "10.0.0.85", port: 80 }]);
  });

  it("keeps an advertised SRV :80 when that is what the service said", () => {
    expect(
      resolveMdnsRecords([
        {
          name: "wled._wled._tcp.local",
          type: "SRV",
          data: { target: "wled.local", port: 80 },
        },
        { name: "wled.local", type: "A", data: "192.168.1.72" },
      ]),
    ).toEqual([{ hostname: "192.168.1.72", port: 80 }]);
  });
});
