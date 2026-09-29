import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { ShortcutOverlay } from "./shortcut-overlay";

describe("app-wide keyboard shortcuts", () => {
  it("opens with ? on the shell, closes with Escape, and restores focus", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ settings: {
      findIntervalSeconds: 0, appearance: "dark",
    } }))));
    render(<AppShell nav="catalog" lightCount={0}><p>LED products content</p></AppShell>);
    const trigger = screen.getByRole("button", { name: "Shortcuts ?" });
    trigger.focus();
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog.textContent).toContain("On a Light’s Segments tab");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("does not take ? from text fields, editable content, or modified keys", () => {
    render(<><ShortcutOverlay /><input aria-label="Name" /><div contentEditable role="textbox" aria-label="Notes" /></>);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "?" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Notes" }), { key: "?" });
    fireEvent.keyDown(window, { key: "?", ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Shortcuts ?" }));
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
