import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LedLoader } from "./led-loader";

describe("LedLoader", () => {
  it("has one accessible loading status and decorative glowing beads", () => {
    render(<LedLoader label="Saving backup…" />);
    const status = screen.getByRole("status");
    expect(within(status).getByText("Saving backup…")).toBeTruthy();
    expect(status.querySelectorAll(".nightplot-loading-led")).toHaveLength(7);
    expect(status.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});
