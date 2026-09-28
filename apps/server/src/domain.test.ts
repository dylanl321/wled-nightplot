import { describe, expect, it } from "vitest";
import { lightDetail, lightFromSnapshot, rowFromProbe, toLightView } from "./domain.ts";

const snapshot = {
  name: "WLED",
  firmware: "WLED 0.15.4",
  mac: "e8:9f:6d:7f:2a:04",
  ledCount: 60,
  rgbw: false,
  on: true,
  brightness: 128,
  segmentColor: "#ffa000",
  segments: [{ start: 0, stop: 60 }],
};

describe("lightFromSnapshot name", () => {
  const target = { hostname: "192.168.1.72", port: 80 };

  it("keeps a cfg-preferred name while /json/info still reports the stale one", () => {
    const enrolled = lightFromSnapshot(target, snapshot, "2026-09-26T18:00:00.000Z");
    const afterWrite = {
      ...enrolled,
      name: "Porch rail",
      nameSource: "cfg" as const,
      staleInfoName: "WLED",
    };
    const refreshed = lightFromSnapshot(target, snapshot, "2026-09-26T18:01:00.000Z", afterWrite);
    expect(refreshed.name).toBe("Porch rail");
    expect(refreshed.nameSource).toBe("cfg");
    expect(refreshed.staleInfoName).toBe("WLED");
  });

  it("follows /json/info once it catches up", () => {
    const existing = {
      ...lightFromSnapshot(target, snapshot, "2026-09-26T18:00:00.000Z"),
      name: "Porch rail",
      nameSource: "cfg" as const,
      staleInfoName: "WLED",
    };
    const refreshed = lightFromSnapshot(
      target,
      { ...snapshot, name: "Porch rail" },
      "2026-09-26T18:02:00.000Z",
      existing,
    );
    expect(refreshed.name).toBe("Porch rail");
    expect(refreshed.nameSource).toBe("info");
    expect(refreshed.staleInfoName).toBeNull();
  });

  it("keeps ledProductId across a snapshot refresh", () => {
    const enrolled = lightFromSnapshot(target, snapshot, "2026-09-26T18:00:00.000Z");
    expect(enrolled.ledProductId).toBeNull();
    const attached = { ...enrolled, ledProductId: "led-ws281x-60-gpio16" };
    const refreshed = lightFromSnapshot(target, snapshot, "2026-09-26T18:01:00.000Z", attached);
    expect(refreshed.ledProductId).toBe("led-ws281x-60-gpio16");
  });

  it("keeps a persisted SK6812 stripKind — does not hardcode ws281x on refresh", () => {
    const enrolled = lightFromSnapshot(target, snapshot, "2026-09-26T18:00:00.000Z");
    expect(enrolled.stripKind).toBe("ws281x");
    const afterWrite = { ...enrolled, stripKind: "sk6812-rgbw" };
    const refreshed = lightFromSnapshot(
      target,
      { ...snapshot, rgbw: true },
      "2026-09-26T18:01:00.000Z",
      afterWrite,
    );
    expect(refreshed.stripKind).toBe("sk6812-rgbw");
    expect(refreshed.rgbw).toBe(true);
  });
});

describe("toLightView strip honesty", () => {
  const target = { hostname: "192.168.1.72", port: 80 };

  it("does not treat snapshot rgbw as a WS281x RGBW chip", () => {
    const light = lightFromSnapshot(target, { ...snapshot, rgbw: true }, "2026-09-26T18:00:00.000Z");
    const view = toLightView(light, { ...snapshot, rgbw: true });
    expect(light.rgbw).toBe(true);
    expect(view.stripKind).toBe("ws281x");
    expect(view.stripBead).toBe("rgb");
    expect(view.stripChip).toBe("WS281x RGB");
  });

  it("follows an attached SK6812 product for the bead and chip", () => {
    const light = {
      ...lightFromSnapshot(target, snapshot, "2026-09-26T18:00:00.000Z"),
      ledProductId: "porch-sk6812",
    };
    const view = toLightView(light, snapshot, {
      elementCount: 0,
      segmentCount: 1,
      driftLabel: null,
      product: {
        id: "porch-sk6812",
        label: "Porch SK6812",
        notes: "Not a WLED write.",
        formFactor: "discrete",
        driverId: "sk6812-rgbw",
      },
    });
    expect(view.stripBead).toBe("rgbw");
    expect(view.stripChip).toBe("SK6812 RGBW");
    expect(view.bead).toBe("#ffa000");
    expect(view.spacingMm).toBeNull();
    expect(view.spacingKind).toBeNull();
  });

  it("copies pitch or COB section length onto the view and ignores the other field", () => {
    const light = lightFromSnapshot(target, snapshot, "2026-09-26T18:00:00.000Z");
    const pitched = toLightView(light, snapshot, {
      elementCount: 0,
      segmentCount: 1,
      driftLabel: null,
      product: {
        id: "eave",
        label: "Eave",
        notes: "",
        formFactor: "discrete",
        driverId: "ws281x",
        pitchMm: 16.67,
        sectionLengthMm: 40,
      },
    });
    expect(pitched.spacingMm).toBe(16.67);
    expect(pitched.spacingKind).toBe("pitch");

    const cob = toLightView(light, snapshot, {
      elementCount: 0,
      segmentCount: 1,
      driftLabel: null,
      product: {
        id: "soffit",
        label: "Soffit",
        notes: "",
        formFactor: "cob",
        driverId: "ws281x",
        pitchMm: 16.67,
        sectionLengthMm: 25,
      },
    });
    expect(cob.spacingMm).toBe(25);
    expect(cob.spacingKind).toBe("section");
  });

  it("keeps unreachable beads unknown on an RGBW product", () => {
    const light = {
      ...lightFromSnapshot(target, snapshot, "2026-09-26T18:00:00.000Z"),
      reachability: "no-answer" as const,
      on: null,
      brightness: null,
      ledProductId: "porch-sk6812",
    };
    const view = toLightView(light, null, {
      elementCount: 0,
      segmentCount: null,
      driftLabel: null,
      product: {
        id: "porch-sk6812",
        label: "Porch SK6812",
        notes: "",
        formFactor: "discrete",
        driverId: "sk6812-rgbw",
      },
    });
    expect(view.bead).toBe("unknown");
    expect(view.stripBead).toBe("rgbw");
    expect(view.stripChip).toBe("SK6812 RGBW");
  });

  it("treats info-only missing on as unknown-grey — not null-as-off", () => {
    const infoOnly = {
      ...snapshot,
      on: null,
      brightness: null,
      segmentColor: null,
      segments: null,
    };
    const light = lightFromSnapshot(target, infoOnly, "2026-09-26T18:00:00.000Z");
    const view = toLightView(light, infoOnly);
    expect(light.reachability).toBe("online");
    expect(light.on).toBeNull();
    expect(view.bead).toBe("unknown");
    expect(view.bead).not.toBeNull();
  });

  it("keeps known off as null — distinct from unknown", () => {
    const off = { ...snapshot, on: false, brightness: 0, segmentColor: null };
    const light = lightFromSnapshot(target, off, "2026-09-26T18:00:00.000Z");
    const view = toLightView(light, off);
    expect(view.on).toBe(false);
    expect(view.bead).toBeNull();
  });
});

describe("rowFromProbe info-only beads", () => {
  const target = { hostname: "192.168.1.90", port: 80 };

  it("uses unknown-grey when found snapshot has no on", () => {
    const row = rowFromProbe(
      target,
      "address-probe",
      {
        kind: "found",
        snapshot: {
          ...snapshot,
          on: null,
          brightness: null,
          segmentColor: null,
          segments: null,
        },
      },
      "2026-09-26T18:00:00.000Z",
      false,
    );
    expect(row.on).toBeNull();
    expect(row.bead).toBe("unknown");
  });
});

describe("lightDetail segmentCount honesty", () => {
  const target = { hostname: "192.168.1.72", port: 80 };

  it("does not present info-only missing segments as zero", () => {
    const infoOnly = {
      ...snapshot,
      on: null,
      brightness: null,
      segmentColor: null,
      segments: null,
    };
    const light = lightFromSnapshot(target, infoOnly, "2026-09-26T18:00:00.000Z");
    const detail = lightDetail(light, infoOnly, []);
    expect(detail.light.reachability).toBe("online");
    expect(detail.light.segmentCount).toBeNull();
    expect(detail.light.segmentCount).not.toBe(0);
    expect(detail.reported).toEqual([]);
  });

  it("does not compare unknown segments as empty rails against declared Segments", () => {
    const infoOnly = {
      ...snapshot,
      on: null,
      brightness: null,
      segmentColor: null,
      segments: null,
    };
    const light = lightFromSnapshot(target, infoOnly, "2026-09-26T18:00:00.000Z");
    const detail = lightDetail(light, infoOnly, [
      { id: "el-door", lightId: light.id, label: "Door", start: 0, stop: 60 },
    ]);
    expect(detail.light.segmentCount).toBeNull();
    expect(detail.light.driftLabel).toBe("Segments unknown — no report to compare.");
    expect(detail.light.driftLabel).not.toMatch(/not on the controller/);
    expect(detail.display.declared[0]?.differs).toBe(false);
    expect(detail.display.regions).toEqual([]);
    expect(detail.reported).toEqual([]);
  });

  it("keeps a known empty seg list as zero — distinct from unknown", () => {
    const empty = { ...snapshot, on: true, segments: [] };
    const light = lightFromSnapshot(target, empty, "2026-09-26T18:00:00.000Z");
    const detail = lightDetail(light, empty, []);
    expect(detail.light.segmentCount).toBe(0);
  });

  it("still flags declared-vs-no-report when seg is a known empty list", () => {
    const empty = { ...snapshot, on: true, segments: [] };
    const light = lightFromSnapshot(target, empty, "2026-09-26T18:00:00.000Z");
    const detail = lightDetail(light, empty, [
      { id: "el-door", lightId: light.id, label: "Door", start: 0, stop: 60 },
    ]);
    expect(detail.light.segmentCount).toBe(0);
    expect(detail.light.driftLabel).toMatch(/not on the controller/);
    expect(detail.display.declared[0]?.differs).toBe(true);
  });

  it("counts reported segments when state.seg is present", () => {
    const light = lightFromSnapshot(target, snapshot, "2026-09-26T18:00:00.000Z");
    const detail = lightDetail(light, snapshot, []);
    expect(detail.light.segmentCount).toBe(1);
    expect(detail.reported).toEqual([{ start: 0, stop: 60, differs: true }]);
  });
});
