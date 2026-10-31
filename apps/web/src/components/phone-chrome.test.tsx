import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "@/components/app-shell";

describe("phone shell", () => {
  it("keeps Lights, Looks, Yard, Sync, and More within reach", () => {
    render(
      <AppShell nav="yard" lightCount={0}>
        <p>Yard content</p>
      </AppShell>,
    );

    expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Lights" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Looks" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Yard" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Sync" }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const sheet = screen.getByRole("dialog", { name: "More" });
    expect(sheet.textContent).toContain("Find Lights");
    expect(sheet.textContent).toContain("LED products");
    expect(sheet.textContent).toContain("Backups");
    expect(sheet.textContent).toContain("Settings");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "More" })).toBeNull();
  });
});
