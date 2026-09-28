import { softwareHonestyCaption, type LiveSource } from "./live.ts";

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

export function manageCaption(source: LiveSource): string {
  return (
    softwareHonestyCaption(source) ??
    "Each Light is listed by what it reported. Not Hardware Done."
  );
}

/**
 * Below this, a duration in All Off unknown-row copy would be misleading
 * (instant refuse). Same 0.5 s honesty gate as CONFIG-28 probe-failed.
 */
export const ALL_OFF_NO_ANSWER_ELAPSED_MIN_MS = 500;

/** All Off unknown-row copy: actual elapsed, or generic refuse. Not a claimed 3 s. */
export function allOffNoAnswerReason(host: string, elapsedMs: number): string {
  const waited = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (waited < ALL_OFF_NO_ANSWER_ELAPSED_MIN_MS) {
    return `no answer from ${host}.`;
  }
  const seconds = Math.max(1, Math.round(waited / 1000));
  return `no answer from ${host} in ${seconds} s.`;
}

/**
 * Below this, a duration in Delete unknown-controller copy would be misleading
 * (instant refuse or unmeasured). Same 0.5 s honesty gate as CONFIG-28 / CONFIG-36.
 */
export const DELETE_UNKNOWN_ELAPSED_MIN_MS = 500;

/** Delete unknown-controller copy: actual elapsed, or generic refuse. Not “in time”. */
export function deleteUnknownControllerReason(elapsedMs?: number): string {
  const waited =
    typeof elapsedMs === "number" && Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (waited < DELETE_UNKNOWN_ELAPSED_MIN_MS) {
    return "Couldn’t read it, so we can’t say what it’ll be left doing.";
  }
  const seconds = Math.max(1, Math.round(waited / 1000));
  return `Couldn’t read it in ${seconds} s, so we can’t say what it’ll be left doing.`;
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
  /** Measured probe wait. Omit or < ~0.5 s → generic copy (no invented duration). */
  controllerWaitMs?: number;
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
        detail: deleteUnknownControllerReason(input.controllerWaitMs),
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
