import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AllOffControl } from "@/components/all-off-control";
import { lightView } from "@/test/fixtures";

describe("AllOffControl unknown-row copy", () => {
  it("shows generic refuse copy without inventing a 3 s wait", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            cancelled: [],
            restored: false,
            rows: [
              {
                lightId: "light-garage",
                name: "Garage",
                status: "unknown",
                detail: "no answer from 192.168.1.63.",
              },
            ],
            failedIds: ["light-garage"],
            message: "0 of 1 off · 1 didn’t answer",
            caption: "Each Light is listed by what it reported. Not Hardware Done.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    render(<AllOffControl size="thumb" lights={[lightView()]} sessions={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "All Off" }));

    expect(await screen.findByText("no answer from 192.168.1.63.")).toBeTruthy();
    expect(screen.getByText("Still unknown")).toBeTruthy();
    expect(screen.queryByText(/in 3 s/)).toBeNull();
  });
});
