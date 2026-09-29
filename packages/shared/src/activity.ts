export type ActivityEntry = {
  id: string;
  at: string;
  lightId: string;
  lightName: string;
  action: "apply" | "preview" | "all-off" | "replacement";
  /** A readback match is never inferred from a successful write alone. */
  readback: "match" | "mismatch" | "unknown" | "not-checked";
  detail: string;
};

const ACTIVITY_ACTIONS = new Set<ActivityEntry["action"]>(["apply", "preview", "all-off"]);
const ACTIVITY_READBACK = new Set<ActivityEntry["readback"]>([
  "match",
  "mismatch",
  "unknown",
  "not-checked",
]);

export function parseActivityEntry(value: unknown): ActivityEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<ActivityEntry>;
  if (
    typeof entry.id !== "string" ||
    !entry.id ||
    typeof entry.at !== "string" ||
    !Number.isFinite(Date.parse(entry.at)) ||
    typeof entry.lightId !== "string" ||
    !entry.lightId ||
    typeof entry.lightName !== "string" ||
    !ACTIVITY_ACTIONS.has(entry.action as ActivityEntry["action"]) ||
    !ACTIVITY_READBACK.has(entry.readback as ActivityEntry["readback"]) ||
    typeof entry.detail !== "string"
  ) {
    return null;
  }
  return {
    id: entry.id,
    at: entry.at,
    lightId: entry.lightId,
    lightName: entry.lightName,
    action: entry.action as ActivityEntry["action"],
    readback: entry.readback as ActivityEntry["readback"],
    detail: entry.detail,
  };
}
