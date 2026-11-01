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
    expect(screen.getByText("122 lights", { selector: "p" })).toBeTruthy();
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
    expect(screen.getAllByText(/Wire in/).length).toBeGreaterThan(0);
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
  it("converts the sizes when switching to Metres, and remembers the unit", () => {
    window.localStorage.clear();
    render(<PropWizard products={[]} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Mini tree/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByLabelText("Height (ft)")).toHaveProperty("value", "3");
    fireEvent.click(screen.getByRole("button", { name: "Metres" }));
    expect(screen.getByLabelText("Height (m)")).toHaveProperty("value", "0.914");
    expect(screen.getByLabelText("Base width (m)")).toHaveProperty("value", "0.914");
    expect(screen.getByLabelText("Light spacing (cm)")).toHaveProperty("value", "10");
    fireEvent.click(screen.getByRole("button", { name: "Feet" }));
    expect(screen.getByLabelText("Height (ft)")).toHaveProperty("value", "3");
    fireEvent.click(screen.getByRole("button", { name: "Metres" }));
    expect(window.localStorage.getItem("nightplot.propUnit")).toBe("m");
  });

  it("starts the next prop in Metres with round metric sizes", () => {
    window.localStorage.setItem("nightplot.propUnit", "m");
    render(<PropWizard products={[]} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Line" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Roofline/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByLabelText("Length (m)")).toHaveProperty("value", "12");
    window.localStorage.clear();
  });
  it("makes a 2 m triangle with exactly 60 lights from a typed count", () => {
    window.localStorage.setItem("nightplot.propUnit", "m");
    render(<PropWizard products={[]} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Mini tree/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Height (m)"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Base width (m)"), { target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("Lights along the base too (a triangle)"));
    fireEvent.change(screen.getByLabelText(/How many lights/), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Name the sections" })).toBeTruthy();
    const counts = screen.getAllByRole("button", { pressed: false }).concat(screen.getAllByRole("button", { pressed: true }))
      .map((button) => button.textContent ?? "");
    expect(counts.some((text) => text.includes("Base"))).toBe(true);
    window.localStorage.clear();
  });
});
