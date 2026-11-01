import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PositionFields } from "./yard-stage";

describe("yard position fields", () => {
  it("shows where the prop sits and moves it to typed metres", () => {
    const onSave = vi.fn();
    render(<PositionFields name="Box" at={{ x: 1, y: 0.5 }} onSave={onSave} />);
    const right = screen.getByLabelText("Box metres right of the origin");
    const up = screen.getByLabelText("Box metres up from the origin");
    expect(right).toHaveProperty("value", "1");
    expect(up).toHaveProperty("value", "0.5");
    expect(screen.getByRole("button", { name: "Move" })).toHaveProperty("disabled", true);
    fireEvent.change(right, { target: { value: "3" } });
    fireEvent.change(up, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(onSave).toHaveBeenCalledWith({ x: 3, y: 1 });
  });

  it("refuses text that is not metres", () => {
    const onSave = vi.fn();
    render(<PositionFields name="Box" at={{ x: 0, y: 0 }} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Box metres right of the origin"), { target: { value: "far" } });
    expect(screen.getByText("Type a number of metres for each.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move" })).toHaveProperty("disabled", true);
  });
});
