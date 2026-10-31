import { describe, expect, it } from "vitest";
import type { Light } from "./lights.ts";
import { DEFAULT_LOOKS, DEFAULT_PLAYLIST, defaultLooksDocument } from "./look.ts";
import { defaultWireframeSpec } from "./prop/wireframe.ts";
import {
  applyHostMatch,
  diffSeason,
  parseSeasonDocument,
  rematchSeasonHost,
  seasonDigest,
  type SeasonDocument,
} from "./season.ts";

const porch: Light = {
  id: "porch",
  name: "Porch",
  controllerKind: "wled",
  stripKind: "ws281x",
  hostname: "192.168.1.40",
  port: 80,
  hostKey: "192.168.1.40:80",
  mac: "aa:bb:cc:dd:ee:ff",
  firmware: "WLED 0.15.4",
  ledCount: 60,
  rgbw: false,
  reachability: "online",
  lastSeenAt: "2026-10-31T12:00:00.000Z",
  on: true,
  brightness: 128,
  enrolledAt: "2026-10-01T00:00:00.000Z",
  ledProductId: null,
};

function season(overrides: Partial<SeasonDocument> = {}): SeasonDocument {
  return {
    version: 1,
    kind: "nightplot-season",
    at: "2026-10-31T12:00:00.000Z",
    lights: [porch],
    elements: [{ id: "el-door", lightId: "porch", label: "Door", start: 0, stop: 20 }],
    props: [{ id: "prop-door", lightId: "porch", label: "Front door", kind: "custom", elementIds: ["el-door"] }],
    setupProfiles: [{ id: "prof-1", name: "Default", ledType: "ws281x" }],
    looks: defaultLooksDocument(),
    devices: [],
    ...overrides,
  };
}

describe("season file", () => {
  it("round-trips a v1 season file and keeps Looks", () => {
    const file = season();
    const parsed = parseSeasonDocument(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.migratedFrom).toBe("season");
    expect(parsed.document.looks?.looks.map((row) => row.name)).toEqual(DEFAULT_LOOKS.map((row) => row.name));
    expect(parsed.document.looks?.playlists[0]?.id).toBe(DEFAULT_PLAYLIST.id);
    const again = parseSeasonDocument(parsed.document);
    expect(again.ok).toBe(true);
    if (again.ok) expect(seasonDigest(again.document)).toBe(seasonDigest(parsed.document));
  });

  it("migrates a Lights-store shape and does not invent Looks", () => {
    const parsed = parseSeasonDocument({
      version: 1,
      lights: [porch],
      elements: [{ id: "el-door", lightId: "porch", label: "Door", start: 0, stop: 20 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.migratedFrom).toBe("lights-store");
    expect(parsed.document.looks).toBeNull();
    expect(parsed.document.lights[0]?.outputs?.[0]?.ledCount).toBe(60);
  });

  it("migrates a Nightplot backup and leaves Looks missing when the backup had none", () => {
    const parsed = parseSeasonDocument({
      version: 1,
      id: "11111111-1111-4111-8111-111111111111",
      at: "2026-10-01T00:00:00.000Z",
      reason: "manual",
      lightId: null,
      lightName: null,
      data: {
        lights: [porch],
        elements: [{ id: "el-door", lightId: "porch", label: "Door", start: 0, stop: 20 }],
        products: [],
        activity: [],
        props: [{ id: "prop-door", lightId: "porch", label: "Front door", kind: "custom", elementIds: ["el-door"] }],
      },
      controller: null,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.migratedFrom).toBe("backup");
    expect(parsed.document.looks).toBeNull();
    expect(parsed.document.props[0]?.label).toBe("Front door");
  });

  it("shows a diff that names added Looks and missing Looks in the file", () => {
    const current = season();
    const incoming = season({
      looks: null,
      lights: [{ ...porch, name: "Porch west" }],
    });
    const diff = diffSeason(current, incoming);
    expect(diff.looks.missingInFile).toBe(true);
    expect(diff.looks.removed.length).toBeGreaterThan(0);
    expect(diff.lights.changed).toContain("Porch west");
    expect(diff.schedule.missingInFile).toBe(true);
  });

  it("rematches a changed IP by MAC and keeps the season host when that MAC still answers", () => {
    const seasonHost = rematchSeasonHost({
      season: porch,
      seasonProbeMac: "aa:bb:cc:dd:ee:ff",
      enrolledByMac: { hostname: "192.168.1.99", port: 80 },
      discoveredByMac: null,
    });
    expect(seasonHost.how).toBe("season-host");
    expect(seasonHost.hostname).toBe("192.168.1.40");

    const moved = rematchSeasonHost({
      season: porch,
      seasonProbeMac: null,
      enrolledByMac: { hostname: "192.168.1.99", port: 80 },
      discoveredByMac: null,
    });
    expect(moved.how).toBe("enrolled-mac");
    expect(applyHostMatch(porch, moved).hostKey).toBe("192.168.1.99:80");

    const found = rematchSeasonHost({
      season: porch,
      seasonProbeMac: null,
      enrolledByMac: null,
      discoveredByMac: { hostname: "10.0.0.8", port: 80 },
    });
    expect(found.how).toBe("found-mac");

    const lost = rematchSeasonHost({
      season: porch,
      seasonProbeMac: null,
      enrolledByMac: null,
      discoveredByMac: null,
    });
    expect(lost.how).toBe("unresolved");
  });

  it("keeps a wireframe Prop and an optional ledmap extra", () => {
    const spec = defaultWireframeSpec({ sides: 8 });
    const file = season({
      props: [{
        id: "well",
        lightId: "porch",
        label: "Well house",
        kind: "wireframe",
        elementIds: ["well-face-0"],
        wireframe: spec,
      }],
      elements: [{ id: "well-face-0", lightId: "porch", label: "Well house · face 1", start: 0, stop: 10 }],
      devices: [{
        lightId: "porch",
        mac: porch.mac,
        hostname: porch.hostname,
        port: porch.port,
        firmware: porch.firmware,
        ledmapJson: "{\"map\":[0,1,2]}\n",
      }],
    });
    const parsed = parseSeasonDocument(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.props[0]?.wireframe?.sides).toBe(8);
    expect(parsed.document.devices[0]?.ledmapJson).toMatch(/map/);
    const changed = season({
      props: [{
        id: "well",
        lightId: "porch",
        label: "Well house",
        kind: "wireframe",
        elementIds: ["well-face-0"],
        wireframe: { ...spec, locks: [{ role: "top.0.end", physicalIndex: 4 }] },
      }],
      elements: file.elements,
    });
    expect(diffSeason(file, changed).props.changed).toContain("Well house");
  });

  it("refuses a file Nightplot does not understand", () => {
    expect(parseSeasonDocument({ hello: true }).ok).toBe(false);
  });
});
