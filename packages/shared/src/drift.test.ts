import { describe, expect, it } from "vitest";
import { buildRangeDisplay } from "./drift.ts";
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
});
