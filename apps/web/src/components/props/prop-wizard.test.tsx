import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PropWizard } from "./prop-wizard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("New prop wizard", () => {
  it("opens a 40 ft roofline in the same editor, showing 122 lights", () => {
    render(<PropWizard products={[]} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Front roof" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Roofline/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Which end is the controller end?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "This end" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/122 lights/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Name sections" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("opens custom draw as the trace editor", () => {
    render(<PropWizard products={[]} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Ridge" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Draw it/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("button", { name: "Trace", pressed: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Name sections" })).toBeTruthy();
    expect(screen.getByText(/where the wire comes in/i)).toBeTruthy();
  });

  it("opens a window after choosing a start corner and a direction", () => {
    render(<PropWizard products={[]} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Bay" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Window/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Bottom left" }));
    fireEvent.click(screen.getByRole("button", { name: "Clockwise" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("button", { name: "Edit", pressed: true })).toBeTruthy();
    expect(screen.getAllByText("Wire in").length).toBeGreaterThan(0);
  });

  it("opens well house sections after the size, with one section per wall", () => {
    render(<PropWizard products={[]} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Well house" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Well house/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("button", { name: "Name sections" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Name sections" }));
    expect(screen.getByRole("heading", { name: "Name the sections" })).toBeTruthy();
    expect(screen.getByLabelText("Section name")).toHaveProperty("value", "Front");
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });
});
