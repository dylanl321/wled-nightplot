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
