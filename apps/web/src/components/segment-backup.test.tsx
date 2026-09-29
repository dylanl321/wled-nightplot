import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { lightDetail } from "@/test/fixtures";
import { SegmentBackupPanel } from "./segment-backup";

const backup = {
  kind: "nightplot-segments", version: 1, exportedAt: "2026-09-28T18:00:00.000Z",
  source: { lightId: "previous", lightName: "Previous Light", mac: "different", ledCount: 60 },
  segments: [{ label: "Door", start: 0, stop: 20 }],
};

describe("Segment backup review", () => {
  it("shows the source and ranges before explicitly restoring to a different Light", async () => {
    const initial = lightDetail();
    const onRestored = vi.fn();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      ...initial, message: "Segments restored to Nightplot. Apply separately.",
    })));
    vi.stubGlobal("fetch", fetcher);
    render(<SegmentBackupPanel detail={initial} blocked={false} onRestored={onRestored} />);
    fireEvent.click(screen.getByText("Back up or restore Segments"));
    const file = new File([JSON.stringify(backup)], "layout.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => JSON.stringify(backup) });
    fireEvent.change(screen.getByLabelText("Choose backup"), { target: { files: [file] } });
    expect(await screen.findByText("Door (0–20)")).toBeTruthy();
    expect(screen.getByText(/Different controller: confirm/)).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `Confirm restore to ${initial.light.name}` }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ backup, confirmDifferentController: true });
  });

  it("does not offer restore when the target has a different LED count", async () => {
    const initial = lightDetail();
    render(<SegmentBackupPanel detail={initial} blocked={false} onRestored={vi.fn()} />);
    fireEvent.click(screen.getByText("Back up or restore Segments"));
    const file = new File([JSON.stringify(backup)], "layout.json");
    Object.defineProperty(file, "text", { value: async () => JSON.stringify({
      ...backup, source: { ...backup.source, ledCount: 61 },
    }) });
    fireEvent.change(screen.getByLabelText("Choose backup"), { target: { files: [file] } });
    const button = await screen.findByRole("button", { name: `Confirm restore to ${initial.light.name}` });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Match the strip length before restoring/)).toBeTruthy();
  });
});
