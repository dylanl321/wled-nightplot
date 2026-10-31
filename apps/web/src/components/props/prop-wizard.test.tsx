import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PropWizard } from "./prop-wizard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("New prop wizard", () => {
  it("walks a 40 ft roofline at 10 cm to 122 lights and leaves custom draw unsaved", () => {
    render(<PropWizard products={[]} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Front roof" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Roofline/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("122 lights")).toBeTruthy();
    expect(screen.getByText("Along the roof")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: /Custom draw/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Custom draw is not ready yet/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("counts an 8-sided well house from sides and side length", () => {
    render(<PropWizard products={[]} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Well" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Well house/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Here is the prop" })).toBeTruthy();
    expect(screen.getByText(/lights/)).toBeTruthy();
  });
});
