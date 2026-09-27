import { describe, expect, it } from "vitest";
import {
  allOffConfirmCopy,
  allOffDockCaption,
  allOffNoAnswerReason,
  allOffRetryLabel,
  allOffRowLabel,
  allOffSummary,
  buildDeleteChecks,
  canDelete,
  deleteProgress,
  deleteRefuseReason,
  deleteUnknownControllerReason,
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

  it("uses generic All Off refuse copy when the wait was instant", () => {
    expect(allOffNoAnswerReason("192.168.1.63", 0)).toBe("no answer from 192.168.1.63.");
    expect(allOffNoAnswerReason("192.168.1.63", 12)).toBe("no answer from 192.168.1.63.");
    expect(allOffNoAnswerReason("192.168.1.63", 499)).toBe("no answer from 192.168.1.63.");
    expect(allOffNoAnswerReason("192.168.1.63", 8)).not.toMatch(/in 3 s/);
  });

  it("names actual elapsed seconds when All Off waited", () => {
    expect(allOffNoAnswerReason("192.168.1.63", 500)).toBe(
      "no answer from 192.168.1.63 in 1 s.",
    );
    expect(allOffNoAnswerReason("192.168.1.63", 2800)).toBe(
      "no answer from 192.168.1.63 in 3 s.",
    );
    expect(allOffNoAnswerReason("192.168.1.63:48210", 6200)).toBe(
      "no answer from 192.168.1.63:48210 in 6 s.",
    );
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

  it("uses generic unknown-controller copy when the wait was instant or unmeasured", () => {
    const generic = "Couldn’t read it, so we can’t say what it’ll be left doing.";
    expect(deleteUnknownControllerReason()).toBe(generic);
    expect(deleteUnknownControllerReason(0)).toBe(generic);
    expect(deleteUnknownControllerReason(12)).toBe(generic);
    expect(deleteUnknownControllerReason(499)).toBe(generic);
    expect(deleteUnknownControllerReason(8)).not.toMatch(/in time/);
    expect(deleteUnknownControllerReason(8)).not.toMatch(/in \d+ s/);
    const locked = buildDeleteChecks({
      elementLabels: ["Left run"],
      sessionLabel: null,
      reachable: false,
      reportedOn: null,
    });
    expect(locked[2]?.detail).toBe(generic);
    expect(locked[2]?.detail).not.toMatch(/in time/);
  });

  it("names actual elapsed seconds when Delete waited", () => {
    expect(deleteUnknownControllerReason(500)).toBe(
      "Couldn’t read it in 1 s, so we can’t say what it’ll be left doing.",
    );
    expect(deleteUnknownControllerReason(2800)).toBe(
      "Couldn’t read it in 3 s, so we can’t say what it’ll be left doing.",
    );
    expect(deleteUnknownControllerReason(6200)).toBe(
      "Couldn’t read it in 6 s, so we can’t say what it’ll be left doing.",
    );
    const waited = buildDeleteChecks({
      elementLabels: ["Left run"],
      sessionLabel: null,
      reachable: false,
      reportedOn: null,
      controllerWaitMs: 2800,
    });
    expect(waited[2]?.detail).toBe(
      "Couldn’t read it in 3 s, so we can’t say what it’ll be left doing.",
    );
    expect(waited[2]?.detail).not.toMatch(/in time/);
  });
});
