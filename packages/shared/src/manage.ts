export type AllOffRowStatus = "off" | "already-off" | "failed" | "unknown";

export type AllOffRow = {
  lightId: string;
  name: string;
  status: AllOffRowStatus;
  detail: string;
};

export type AllOffCancelled = {
  lightId: string;
  kind: "preview" | "blink";
  label: string;
  name: string;
};

export type AllOffResult = {
  cancelled: AllOffCancelled[];
  restored: false;
  rows: AllOffRow[];
  failedIds: string[];
  message: string;
  caption: string;
};

export type DeleteCheckKey = "elements" | "sessions" | "controller";
export type DeleteCheckStatus = "ok" | "blocked" | "unknown";

export type DeleteCheck = {
  key: DeleteCheckKey;
  label: string;
  status: DeleteCheckStatus;
  detail: string;
};

export function manageCaption(source: "fixture" | "controller"): string {
  if (source === "fixture") {
    return "Software-green from the fixture. Not Hardware Done.";
  }
  return "Each Light is listed by what it reported. Not Hardware Done.";
}

export function allOffSummary(rows: AllOffRow[], cancelled: AllOffCancelled[]): string {
  if (rows.length === 0) return "No Lights to turn off.";
  const off = rows.filter((row) => row.status === "off" || row.status === "already-off").length;
  const failed = rows.filter((row) => row.status === "failed" || row.status === "unknown").length;
  const preview = cancelled.find((item) => item.kind === "preview");
  const parts = [`${off} of ${rows.length} off`];
  if (failed) parts.push(`${failed} didn’t answer`);
  if (preview) {
    return `${parts.join(" · ")}. The Preview on ${preview.label} ended without restoring.`;
  }
  if (cancelled.length > 0) {
    return `${parts.join(" · ")}. Live sessions ended without restoring.`;
  }
  return parts.join(" · ");
}

export function buildDeleteChecks(input: {
  elementLabels: string[];
  sessionLabel: string | null;
  reachable: boolean;
  reportedOn: boolean | null;
}): DeleteCheck[] {
  const names =
    input.elementLabels.length > 0 ? input.elementLabels.join(" and ") : "no named Elements";
  const elements: DeleteCheck = {
    key: "elements",
    label: "Elements",
    status: "ok",
    detail: `Nightplot forgets ${names}. The controller keeps its segments.`,
  };
  const sessions: DeleteCheck = input.sessionLabel
    ? {
        key: "sessions",
        label: "Live sessions",
        status: "blocked",
        detail: `Something is live on ${input.sessionLabel}. End it first — Delete will not override that.`,
      }
    : {
        key: "sessions",
        label: "Live sessions",
        status: "ok",
        detail: "Nothing previewing or blinking.",
      };
  const controller: DeleteCheck = !input.reachable
    ? {
        key: "controller",
        label: "Controller state",
        status: "unknown",
        detail: "Couldn’t read it in time, so we can’t say what it’ll be left doing.",
      }
    : {
        key: "controller",
        label: "Controller state",
        status: "ok",
        detail:
          input.reportedOn === false
            ? "Off. It stays exactly as it is."
            : "Answering. It stays exactly as it is.",
      };
  return [elements, sessions, controller];
}

export function deleteProgress(checks: DeleteCheck[]): { done: number; total: number } {
  return {
    done: checks.filter((check) => check.status === "ok").length,
    total: checks.length,
  };
}

export function canDelete(checks: DeleteCheck[]): boolean {
  return checks.length > 0 && checks.every((check) => check.status === "ok");
}

export function deleteRefuseReason(checks: DeleteCheck[]): string | null {
  if (canDelete(checks)) return null;
  const unknown = checks.find((check) => check.status === "unknown");
  if (unknown) {
    return "Unknown impact is not safe. There is no “I understand” override.";
  }
  const blocked = checks.find((check) => check.status === "blocked");
  return blocked?.detail ?? "Checks are not complete.";
}

export function allOffRowLabel(status: AllOffRowStatus): string {
  if (status === "unknown") return "Still unknown";
  if (status === "failed") return "Failed";
  return "Off";
}

export function allOffRetryLabel(rows: AllOffRow[]): string | null {
  const failed = rows.filter((row) => row.status === "failed" || row.status === "unknown");
  if (failed.length === 0) return null;
  if (failed.length === 1) return `Retry ${failed[0]!.name} only`;
  return `Retry ${failed.length} Lights`;
}

export type AllOffLiveHint = {
  kind: "preview" | "blink";
  label: string;
  name: string;
};

export function allOffConfirmCopy(input: {
  live: AllOffLiveHint | null;
  lightCount: number;
  missingNames: string[];
}): { title: string; ends: string | null; colour: string | null; then: string } {
  const kindLabel = input.live?.kind === "blink" ? "Blink" : "Preview";
  const ends = input.live
    ? `The ${kindLabel} on ${input.live.name} · ${input.live.label} ends.`
    : null;
  const colour = input.live ? "Its old colour won’t come back." : null;
  if (input.lightCount === 0) {
    return { title: "Turn everything off?", ends, colour, then: "No Lights to turn off." };
  }
  const noun = input.lightCount === 1 ? "Light" : "Lights";
  const missing =
    input.missingNames.length === 1
      ? `${input.missingNames[0]} isn’t answering and may fail.`
      : input.missingNames.length > 1
        ? `${input.missingNames.length} aren’t answering and may fail.`
        : "";
  return {
    title: "Turn everything off?",
    ends,
    colour,
    then: [`Then ${input.lightCount} ${noun} power off.`, missing].filter(Boolean).join(" "),
  };
}

export function allOffDockCaption(input: {
  liveKind: "preview" | "blink" | null;
  lightCount: number;
  onCount: number;
  missingCount: number;
}): string {
  if (input.liveKind === "preview") return "Ends the Preview without restoring";
  if (input.liveKind === "blink") return "Ends the Blink without restoring";
  if (input.lightCount === 0) return "No Lights to turn off yet";
  if (input.missingCount > 0) {
    return `${input.onCount} Light${input.onCount === 1 ? "" : "s"} on · ${input.missingCount} not answering`;
  }
  return `${input.lightCount} Light${input.lightCount === 1 ? "" : "s"}`;
}
