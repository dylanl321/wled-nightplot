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
  it("names the page range and the controller range once", () => {
    expect(
      explainDrift(
        display({
          declared: [
            {
              id: "a",
              label: "Element 1",
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
    ).toEqual(["Element 1 is 0–40 here. The controller has 0–67."]);
  });

  it("says when the controller has nothing on an Element", () => {
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
              label: "Element 1",
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
      "The controller still has 15–20 and 35–60. No Element on this page covers them.",
    ]);
  });
});
