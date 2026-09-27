import { describe, expect, it } from "vitest";
import { buildRangeDisplay, reportedRangeRails } from "./drift.ts";
import { validateDeclaredRanges } from "./range.ts";

describe("buildRangeDisplay", () => {
  it("marks coverage drift when declared stops short of the report", () => {
    const declared = [
      { id: "l", label: "Left run", start: 0, stop: 24 },
      { id: "r", label: "Right run", start: 24, stop: 50 },
    ];
    const reported = [{ start: 0, stop: 60 }];
    const display = buildRangeDisplay(declared, reported);

    expect(display.declared.map((rail) => rail.differs)).toEqual([true, true]);
    expect(display.reported).toEqual([{ start: 0, stop: 60, differs: true }]);
    expect(display.regions).toContainEqual({ kind: "drift", start: 50, stop: 60 });
    expect(display.notes.map((note) => note.text)).toEqual(
      expect.arrayContaining([
        "Left run reports 36 more LEDs than declared",
        "Right run is not on the controller",
      ]),
    );
  });

  it("labels a shorter reported tail the way Inspect reads it", () => {
    const display = buildRangeDisplay(
      [
        { id: "l", label: "Left run", start: 0, stop: 120 },
        { id: "p", label: "Peak", start: 120, stop: 180 },
        { id: "r", label: "Right run", start: 180, stop: 300 },
      ],
      [
        { start: 0, stop: 120 },
        { start: 120, stop: 180 },
        { start: 180, stop: 290 },
      ],
    );
    expect(display.regions).toEqual([{ kind: "drift", start: 290, stop: 300 }]);
    expect(display.notes).toEqual([
      expect.objectContaining({
        text: "Right run reports 10 fewer LEDs than declared",
        start: 180,
        stop: 290,
      }),
    ]);
    expect(display.declared.find((rail) => rail.label === "Right run")?.differs).toBe(
      true,
    );
    expect(display.reported.find((rail) => rail.start === 180)?.differs).toBe(true);
  });

  it("paints overlap as an error region and leaves matching rails quiet", () => {
    const declared = [
      { id: "p", label: "Peak", start: 120, stop: 185 },
      { id: "r", label: "Right run", start: 180, stop: 300 },
    ];
    const issues = validateDeclaredRanges(declared, 300);
    const display = buildRangeDisplay(
      declared,
      [
        { start: 120, stop: 180 },
        { start: 180, stop: 300 },
      ],
      issues,
    );
    expect(display.regions).toContainEqual({ kind: "error", start: 180, stop: 185 });
    expect(display.declared.every((rail) => rail.error)).toBe(true);
  });

  it("flags a declared range that runs past the strip — not a match", () => {
    const declared = [{ id: "d", label: "Door", start: 0, stop: 60 }];
    const issues = validateDeclaredRanges(declared, 30);
    const display = buildRangeDisplay(declared, [{ start: 0, stop: 30 }], issues);
    expect(display.declared[0]?.error).toBe(true);
    expect(display.notes[0]?.text).toMatch(/Door 0–60 runs past the strip \(30 LEDs\)/);
  });

  it("does not invent a last report when the Light is unreachable", () => {
    const display = buildRangeDisplay(
      [{ id: "d", label: "Door", start: 0, stop: 90 }],
      [{ start: 0, stop: 90 }],
      [],
      { reachable: false },
    );
    expect(display.reported).toEqual([]);
    expect(display.notes).toEqual([{ text: "No current report to compare." }]);
    expect(display.regions).toEqual([]);
  });

  it("does not treat unknown segments as an empty report", () => {
    const display = buildRangeDisplay(
      [{ id: "d", label: "Door", start: 0, stop: 60 }],
      null,
    );
    expect(display.declared[0]?.differs).toBe(false);
    expect(display.reported).toEqual([]);
    expect(display.regions).toEqual([]);
    expect(display.notes).toEqual([
      { text: "Segments unknown — no report to compare." },
    ]);
    expect(display.notes.map((note) => note.text).join(" ")).not.toMatch(
      /not on the controller/,
    );
  });

  it("still compares a known empty seg list as empty — distinct from unknown", () => {
    const display = buildRangeDisplay(
      [{ id: "d", label: "Door", start: 0, stop: 60 }],
      [],
    );
    expect(display.declared[0]?.differs).toBe(true);
    expect(display.regions).toEqual([{ kind: "drift", start: 0, stop: 60 }]);
    expect(display.notes.map((note) => note.text)).toEqual([
      "Door is not on the controller",
    ]);
  });
});

describe("reportedRangeRails", () => {
  it("keeps Inspect range rails and ignores Preview match counts", () => {
    expect(reportedRangeRails([{ start: 0, stop: 60, differs: true }])).toEqual([
      { start: 0, stop: 60 },
    ]);
    expect(reportedRangeRails({ matched: 26, total: 26 })).toEqual([]);
    expect(reportedRangeRails(null)).toEqual([]);
  });
});
