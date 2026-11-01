import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColourField, parseHex } from "./colour-field";

describe("colour field", () => {
  it("reads hex with or without #, in any case", () => {
    expect(parseHex("FF0000")).toBe("#ff0000");
    expect(parseHex(" #00ff00 ")).toBe("#00ff00");
    expect(parseHex("#00ff0")).toBeNull();
    expect(parseHex("red")).toBeNull();
  });

  it("takes a typed hex code and leaves a half-typed one alone", () => {
    const onChange = vi.fn();
    render(<ColourField label="Top colour" value="#ffb000" onChange={onChange} />);
    const text = screen.getByLabelText("Top colour hex");
    expect(text).toHaveProperty("value", "#ffb000");
    fireEvent.change(text, { target: { value: "#ff00" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(text.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(text, { target: { value: "FF0000" } });
    expect(onChange).toHaveBeenCalledWith("#ff0000");
  });
});
