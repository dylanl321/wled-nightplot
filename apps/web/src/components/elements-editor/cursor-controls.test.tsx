import { useReducer, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CursorControls } from "./cursor-controls";
import { editorReducer, initialEditorState } from "./use-editor-state";

function Harness() {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState([], 12, "l"));
  const [live, setLive] = useState(false);
  return <CursorControls state={state} dispatch={dispatch} live={live} blocked={false} onPreview={() => setLive(true)} />;
}

function cursor() { return (screen.getByRole("slider", { name: "Strip cursor" }) as HTMLInputElement).value; }
async function tick(ms = 334) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("cursor navigation", () => {
  it("scans without hover, pauses, changes direction and stops at the end", async () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Auto-scan" }));
    await tick();
    expect(cursor()).toBe("1");
    fireEvent.mouseLeave(screen.getByRole("region"));
    await tick();
    expect(cursor()).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Pause scan" }));
    await tick(1000);
    expect(cursor()).toBe("2");
    fireEvent.change(screen.getByLabelText("Scan direction"), { target: { value: "-1" } });
    fireEvent.change(screen.getByLabelText("Scan speed"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Auto-scan" }));
    await tick(100);
    expect(cursor()).toBe("1");
    await tick(100);
    expect(cursor()).toBe("0");
    expect((screen.getByRole("button", { name: "Auto-scan" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("pauses on tab hiding and targeted All Off without automatically restarting", async () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Auto-scan" }));
    await tick();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    await tick(1000);
    expect(cursor()).toBe("1");
    vi.restoreAllMocks();
    fireEvent(document, new Event("visibilitychange"));
    await tick();
    expect(cursor()).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Auto-scan" }));
    fireEvent(window, new CustomEvent("nightplot:all-off", { detail: { lightIds: ["other"] } }));
    await tick();
    expect(cursor()).toBe("2");
    fireEvent(window, new CustomEvent("nightplot:all-off", { detail: { lightIds: ["l"] } }));
    await tick(1000);
    expect(cursor()).toBe("2");
  });

  it("steps with keyboard and exposes marking and creation together", () => {
    render(<Harness />);
    const panel = screen.getByRole("region");
    fireEvent.keyDown(panel, { key: "ArrowRight", shiftKey: true });
    expect(cursor()).toBe("10");
    fireEvent.keyDown(panel, { key: "[" });
    fireEvent.keyDown(panel, { key: "ArrowLeft" });
    fireEvent.keyDown(panel, { key: "]" });
    expect(screen.getByText(/Selected LEDs 9–10/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create Segment" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
