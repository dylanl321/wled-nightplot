import type { DiscoverRow, LightDetail, LightView, RangeDisplay } from "@nightplot/shared";

/** CONFIG-14/25 honesty copy — firmware often lists :80 when HTTP is not. */
export const ESPALEXA_PORT_WARNING =
  "This SSDP reply looks like Espalexa (Hue-shaped). The advertised port may be wrong — firmware often lists :80 when HTTP is not on 80. Type host:port. Find will not try another port.";

export function discoverRow(overrides: Partial<DiscoverRow> = {}): DiscoverRow {
  return {
    key: "192.168.1.80:80",
    hostname: "192.168.1.80",
    port: 80,
    displayHost: "192.168.1.80",
    via: "ssdp",
    status: "rejected",
    reason: "Answered, but it is not WLED.",
    reasonCode: "not-wled",
    name: null,
    ledCount: null,
    firmware: null,
    mac: null,
    on: null,
    bead: null,
    foundAt: "2026-09-26T18:00:00.000Z",
    portWarning: null,
    ...overrides,
  };
}

export function lightView(overrides: Partial<LightView> = {}): LightView {
  return {
    id: "light-garage",
    name: "Garage",
    controllerKind: "wled",
    stripKind: "ws281x",
    hostname: "192.168.1.40",
    port: 80,
    hostKey: "192.168.1.40:80",
    mac: "e8:9f:6d:7f:2a:04",
    firmware: "WLED 0.15.4",
    ledCount: 60,
    rgbw: false,
    stripBead: "rgb",
    stripChip: "WS281x RGB",
    reachability: "no-answer",
    lastSeenAt: "2026-09-26T18:00:00.000Z",
    on: null,
    brightness: null,
    enrolledAt: "2026-09-26T17:00:00.000Z",
    ledProductId: null,
    bead: "unknown",
    displayHost: "192.168.1.40",
    elementCount: 1,
    segmentCount: null,
    driftLabel: null,
    declared: [],
    ...overrides,
  };
}

const emptyDisplay: RangeDisplay = {
  declared: [
    {
      id: "el-door",
      label: "Door",
      start: 0,
      stop: 60,
      length: 60,
      differs: false,
      error: false,
    },
  ],
  reported: [],
  regions: [],
  notes: [{ text: "No current report to compare." }],
};

export function lightDetail(overrides: Partial<LightDetail> = {}): LightDetail {
  const light = overrides.light ?? lightView();
  return {
    light,
    elements: [
      { id: "el-door", lightId: light.id, label: "Door", start: 0, stop: 60 },
    ],
    reported: [],
    display: emptyDisplay,
    snapshotAt: null,
    session: null,
    liveLeds: null,
    liveCaption: null,
    ...overrides,
  };
}

export function requestPath(url: string): string {
  try {
    return new URL(url, "http://127.0.0.1").pathname;
  } catch {
    return url;
  }
}

/** GET /api/lights — the enrolled list. Must not be a live probe. */
export function isLightsListPath(path: string): boolean {
  return path === "/api/lights";
}

/** Inspect GET /:id or explicit POST /:id/refresh. */
export function isOneLightProbe(path: string, id: string): boolean {
  return path === `/api/lights/${id}` || path === `/api/lights/${id}/refresh`;
}
