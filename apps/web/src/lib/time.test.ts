import { describe, expect, it } from "vitest";
import { answeredLabel } from "./time";

describe("answered age", () => {
  const now = Date.parse("2026-09-26T18:00:00Z");
  it("uses seconds then larger units from the recorded answer", () => {
    expect(answeredLabel(new Date(now - 12_000).toISOString(), now)).toBe("Answered 12s ago");
    expect(answeredLabel(new Date(now - 120_000).toISOString(), now)).toBe("Answered 2m ago");
    expect(answeredLabel(new Date(now - 7_200_000).toISOString(), now)).toBe("Answered 2h ago");
  });
  it("does not turn missing, invalid or future timestamps into a recent answer", () => {
    expect(answeredLabel(null, now)).toBe("Answer time unknown");
    expect(answeredLabel("invalid", now)).toBe("Answer time unknown");
    expect(answeredLabel(new Date(now + 60_000).toISOString(), now)).toBe("Answer time unknown");
  });
});
