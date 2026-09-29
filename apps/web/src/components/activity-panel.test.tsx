import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActivityPanel } from "./activity-panel";
import { LightDetail } from "./light-detail";
import { lightDetail } from "@/test/fixtures";

describe("Light Activity", () => {
  it("shows readback honesty and reloads saved entries", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ entries: [{
      id: "one", at: "2026-09-28T18:00:00Z", lightId: "porch", lightName: "Porch",
      action: "preview", readback: "not-checked", detail: "Preview started; temporary look sent. Not Apply.",
    }] })));
    vi.stubGlobal("fetch", fetcher);
    render(<ActivityPanel lightId="porch" />);
    expect(await screen.findByText("Preview started; temporary look sent. Not Apply.")).toBeTruthy();
    expect(screen.getByText("Not checked")).toBeTruthy();
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/activity?lightId=porch");
    fireEvent.click(screen.getByRole("button", { name: "Refresh activity" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it("opens Activity on a Light without starting another Inspect", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ entries: [] })));
    vi.stubGlobal("fetch", fetcher);
    render(<LightDetail initial={lightDetail()} tab="elements" />);
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(await screen.findByText("No activity recorded for this Light yet.")).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toMatch(/^\/api\/activity\?lightId=/);
  });
});
