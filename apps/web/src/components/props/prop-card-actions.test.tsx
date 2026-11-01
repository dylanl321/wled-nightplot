import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PropCardActions } from "./prop-card-actions";

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("prop card Rename and Delete", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renames with one PATCH carrying only the name", async () => {
    const fetcher = vi.fn(async () => respond({ prop: { id: "x", label: "Box" } }));
    vi.stubGlobal("fetch", fetcher);
    render(<PropCardActions id="x" label="X" attached={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("New name for X"), { target: { value: " Box " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText("Renamed to Box.")).toBeTruthy();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/props/x");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ label: "Box" });
  });

  it("asks once before Delete, and Keep it sends nothing", async () => {
    const fetcher = vi.fn(async () => respond({ deleted: "line", message: "Deleted Line from Nightplot." }));
    vi.stubGlobal("fetch", fetcher);
    render(<PropCardActions id="line" label="Line" attached />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/keeps its lights as they are until the next Apply/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete prop" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/props/line");
    expect(init.method).toBe("DELETE");
  });
});
