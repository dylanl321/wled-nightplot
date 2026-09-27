import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeleteLight } from "@/components/delete-light";

const genericUnknown =
  "Couldn’t read it, so we can’t say what it’ll be left doing.";

describe("DeleteLight unknown-controller copy", () => {
  it("shows generic refuse copy without inventing a wait", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            checks: [
              {
                key: "elements",
                label: "Elements",
                status: "ok",
                detail: "Nightplot forgets Door. The controller keeps its segments.",
              },
              {
                key: "sessions",
                label: "Live sessions",
                status: "ok",
                detail: "Nothing previewing or blinking.",
              },
              {
                key: "controller",
                label: "Controller state",
                status: "unknown",
                detail: genericUnknown,
              },
            ],
            caption: "Each Light is listed by what it reported. Not Hardware Done.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    render(<DeleteLight lightId="light-garage" name="Garage" />);
    fireEvent.click(screen.getByRole("button", { name: "Remove this Light" }));

    expect(await screen.findByText(genericUnknown)).toBeTruthy();
    expect(screen.getByText("Unknown impact is not safe. There is no “I understand” override.")).toBeTruthy();
    expect(screen.queryByText(/in time/)).toBeNull();
  });
});
