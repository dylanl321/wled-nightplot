import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GlowingLedLoader } from "./glowing-led-loader";

describe("GlowingLedLoader", () => {
  it("exposes a polite status name and reduced-motion classes", () => {
    render(<GlowingLedLoader label="Applying" />);
    const status = screen.getByRole("status", { name: "Applying" });
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.querySelector(".sr-only")?.textContent).toBe("Applying");
    const bead = status.querySelector(".nightplot-led-glow");
    expect(bead?.className).toMatch(/motion-reduce:animate-none/);
    expect(bead?.className).toMatch(/motion-reduce:opacity-70/);
  });
});
