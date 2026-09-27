import { describe, expect, it } from "vitest";
import { parseWledPayload } from "./snapshot.ts";

const wledJson = {
  info: {
    ver: "0.15.4",
    name: "WLED-7F2A",
    mac: "e89f6d7f2a04",
    brand: "WLED",
    leds: { count: 60, rgbw: false },
  },
  state: {
    on: true,
    bri: 128,
    seg: [{ col: [[255, 160, 0]] }],
  },
};

describe("parseWledPayload", () => {
  it("reads a combined /json snapshot", () => {
    const snap = parseWledPayload(wledJson);
    expect(snap).toMatchObject({
      name: "WLED-7F2A",
      firmware: "WLED 0.15.4",
      mac: "e8:9f:6d:7f:2a:04",
      ledCount: 60,
      on: true,
      segmentColor: "#ffa000",
      segments: [{ start: 0, stop: 60 }],
    });
  });

  it("reads reported segment bounds from state.seg", () => {
    const snap = parseWledPayload({
      ...wledJson,
      state: {
        on: true,
        bri: 128,
        seg: [
          { start: 0, stop: 24, col: [[255, 160, 0]] },
          { start: 24, stop: 55, col: [[255, 160, 0]] },
        ],
      },
    });
    expect(snap?.segments).toEqual([
      { start: 0, stop: 24 },
      { start: 24, stop: 55 },
    ]);
  });

  it("reads identity from /json/info when state is missing", () => {
    const snap = parseWledPayload({ info: wledJson.info });
    expect(snap).toMatchObject({
      name: "WLED-7F2A",
      firmware: "WLED 0.15.4",
      mac: "e8:9f:6d:7f:2a:04",
      ledCount: 60,
      on: null,
      brightness: null,
      segmentColor: null,
      segments: [],
    });
  });

  it("rejects HTML or a non-WLED JSON box", () => {
    expect(parseWledPayload({ ok: true, server: "nginx" })).toBeNull();
    expect(parseWledPayload("<html>not wled</html>")).toBeNull();
  });
});
