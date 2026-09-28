import { describe, expect, it } from "vitest";
import type { RangeDisplay } from "@nightplot/shared";
import { explainDrift } from "./drift-copy";

function display(partial: Partial<RangeDisplay>): RangeDisplay {
  return {
    declared: [],
    reported: [],
    regions: [],
    notes: [],
    ...partial,
  };
}

describe("explainDrift", () => {
  it("explains several Segments under one controller range together", () => {
    expect(explainDrift(display({
      declared: [[0, 15], [15, 30], [30, 59]].map(([start, stop], index) => ({
        label: `Element ${index + 1}`, start: start!, stop: stop!, length: stop! - start!,
        differs: true, error: false,
      })),
      reported: [{ start: 0, stop: 60, differs: true }],
    }))).toEqual([
      "This page has 3 Segments: Element 1 (0–15), Element 2 (15–30), Element 3 (30–59). The controller has one range across them: 0–60.",
    ]);
  });

  it("names the page range and the controller range once", () => {
    expect(
      explainDrift(
        display({
          declared: [
            {
              id: "a",
              label: "Segment 1",
              start: 0,
              stop: 40,
              length: 40,
              differs: true,
              error: false,
            },
          ],
          reported: [{ start: 0, stop: 67, differs: true }],
        }),
      ),
    ).toEqual(["Segment 1 is 0–40 here. The controller has 0–67."]);
  });

  it("says when the controller has nothing on a Segment", () => {
    expect(
      explainDrift(
        display({
          declared: [
            {
              label: "Door",
              start: 0,
              stop: 60,
              length: 60,
              differs: true,
              error: false,
            },
          ],
        }),
      ),
    ).toEqual(["Door is 0–60 here. The controller has nothing there."]);
  });

  it("lists a repeated controller range once", () => {
    expect(
      explainDrift(
        display({
          declared: [
            {
              label: "Segment 1",
              start: 0,
              stop: 10,
              length: 10,
              differs: false,
              error: false,
            },
          ],
          reported: [
            { start: 35, stop: 60, differs: true },
            { start: 35, stop: 60, differs: true },
            { start: 35, stop: 60, differs: true },
            { start: 15, stop: 20, differs: true },
          ],
        }),
      ),
    ).toEqual([
      "The controller still has 15–20 and 35–60. No Segment on this page covers them.",
    ]);
  });
});
