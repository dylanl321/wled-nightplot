import { describe, expect, it } from "vitest";
import {
  allOffConfirmCopy,
  allOffDockCaption,
  allOffRetryLabel,
  allOffRowLabel,
  allOffSummary,
  buildDeleteChecks,
  canDelete,
  deleteProgress,
  deleteRefuseReason,
  manageCaption,
} from "./manage.ts";

describe("all-off copy", () => {
  it("names a Preview that ended without restore", () => {
    const text = allOffSummary(
      [
        { lightId: "a", name: "WLED", status: "off", detail: "reports on: false" },
        { lightId: "b", name: "Other", status: "unknown", detail: "no answer" },
      ],
      [{ lightId: "a", kind: "preview", label: "Left run", name: "WLED" }],
    );
    expect(text).toMatch(/1 of 2 off/);
    expect(text).toMatch(/ended without restoring/);
    expect(manageCaption("fixture")).toMatch(/Not Hardware Done/);
    expect(allOffRowLabel("unknown")).toBe("Still unknown");
    expect(
      allOffRetryLabel([
        { lightId: "a", name: "WLED", status: "off", detail: "" },
        { lightId: "b", name: "Garage", status: "unknown", detail: "" },
      ]),
    ).toBe("Retry Garage only");
    const confirm = allOffConfirmCopy({
      live: { kind: "preview", label: "Peak", name: "Eave front" },
      lightCount: 3,
      missingNames: ["Garage"],
    });
    expect(confirm.ends).toMatch(/Preview on Eave front · Peak/);
    expect(confirm.colour).toMatch(/won’t come back/);
    expect(confirm.then).toMatch(/Garage isn’t answering/);
    expect(
      allOffDockCaption({
        liveKind: "preview",
        lightCount: 2,
        onCount: 1,
        missingCount: 1,
      }),
    ).toMatch(/without restoring/);
  });
});

describe("delete checks", () => {
  it("unlocks only when every check is complete", () => {
    const locked = buildDeleteChecks({
      elementLabels: ["Left run"],
      sessionLabel: null,
      reachable: false,
      reportedOn: null,
    });
    expect(deleteProgress(locked)).toEqual({ done: 2, total: 3 });
    expect(canDelete(locked)).toBe(false);
    expect(deleteRefuseReason(locked)).toMatch(/I understand/);

    const live = buildDeleteChecks({
      elementLabels: ["Left run"],
      sessionLabel: "Left run",
      reachable: true,
      reportedOn: true,
    });
    expect(canDelete(live)).toBe(false);

    const ready = buildDeleteChecks({
      elementLabels: ["Left run", "Right run"],
      sessionLabel: null,
      reachable: true,
      reportedOn: false,
    });
    expect(canDelete(ready)).toBe(true);
    expect(deleteRefuseReason(ready)).toBeNull();
    expect(ready[2]?.detail).toMatch(/Off/);
  });
});
