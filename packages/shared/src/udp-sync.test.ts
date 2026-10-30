import { describe, expect, it } from "vitest";
import { buildUdpSyncWrite, groupsFromMask, parseWledUdpSync, udpSyncMatches, udpSyncRole } from "./udp-sync.ts";

const cfg = (send: Record<string, unknown>, recv: Record<string, unknown>) => ({
  if: { sync: { port0: 21324, port1: 65506, send: { en: false, dir: false, grp: 1, ...send },
    recv: { bri: true, col: true, fx: true, pal: true, grp: 1, sb: false, ...recv } } },
});

describe("WLED UDP sync", () => {
  it("reads WLED defaults and refuses a missing shape", () => {
    const read = parseWledUdpSync(cfg({}, {}))!;
    expect(read).toMatchObject({ send: false, sendGroups: 1, receiveGroups: 1, port: 21324 });
    expect(udpSyncRole(read, 1)).toBe("follower");
    expect(parseWledUdpSync({ if: {} })).toBeNull();
    expect(parseWledUdpSync({ if: { sync: { send: { en: true }, recv: { grp: 1 } } } })).toBeNull();
  });

  it("makes a leader send its group, with direct changes, and stop receiving it", () => {
    const current = parseWledUdpSync(cfg({}, { grp: 3 }))!;
    const { body, expected } = buildUdpSyncWrite(current, "leader", 2);
    expect(body.if.sync.send).toEqual({ en: true, dir: true, grp: 2 });
    expect(body.if.sync.recv).toMatchObject({ grp: 1, sb: false });
    expect(udpSyncRole(expected, 2)).toBe("leader");
  });

  it("adds to the groups a Light already broadcasts", () => {
    const current = parseWledUdpSync(cfg({ en: true, grp: 1 }, {}))!;
    expect(buildUdpSyncWrite(current, "leader", 2).expected.sendGroups).toBe(3);
  });

  it("makes a follower receive every look field but never segment bounds, keeping other groups", () => {
    const current = parseWledUdpSync(cfg({ en: true, grp: 4 }, { grp: 0, col: false, sb: true }))!;
    const { body, expected } = buildUdpSyncWrite(current, "follower", 3);
    expect(body.if.sync.recv).toEqual({ grp: 4, bri: true, col: true, fx: true, pal: true, sb: false });
    expect(body.if.sync.send).toMatchObject({ en: false, grp: 0 });
    expect(groupsFromMask(expected.receiveGroups)).toEqual([3]);
  });

  it("turns one group off without touching another", () => {
    const current = parseWledUdpSync(cfg({ en: true, grp: 0b101 }, { grp: 0b10 }))!;
    const { expected } = buildUdpSyncWrite(current, "off", 1);
    expect(expected).toMatchObject({ send: true, sendGroups: 0b100, receiveGroups: 0b10 });
  });

  it("matches only the full expected read", () => {
    const current = parseWledUdpSync(cfg({}, {}))!;
    const { expected } = buildUdpSyncWrite(current, "leader", 1);
    expect(udpSyncMatches(expected, expected)).toBe(true);
    expect(udpSyncMatches(expected, { ...expected, sendDirect: false })).toBe(false);
    expect(udpSyncMatches(expected, null)).toBeNull();
  });
});
