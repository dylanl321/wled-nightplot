import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LightView } from "@nightplot/shared";
import { UdpSyncSection } from "./udp-sync-section";

const light = (id: string, name: string) => ({ id, name, reachability: "online" }) as unknown as LightView;

describe("WLED sync groups", () => {
  it("keeps one leader, sends only changed roles, and shows each reread", async () => {
    const posts: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ message: "2 of 2 report the WLED sync role sent.", caption: "Not Hardware Done.",
          rows: [{ lightId: "desk", lightName: "Desk", status: "matched", detail: "Reports that it sends group 3." }] }));
      }
      return new Response(JSON.stringify({ rows: [{ lightId: "desk", lightName: "Desk", sendGroups: [3], receiveGroups: [1] }] }));
    }));
    render(<UdpSyncSection lights={[light("desk", "Desk"), light("shelf", "Shelf"), light("porch", "Porch")]} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Sync group" }), { target: { value: "3" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Desk role" }), { target: { value: "leader" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Shelf role" }), { target: { value: "leader" } });
    expect((screen.getByRole("combobox", { name: "Desk role" }) as HTMLSelectElement).value).toBe("follower");
    fireEvent.click(screen.getByRole("button", { name: "Set group 3" }));
    expect(await screen.findByText("2 of 2 report the WLED sync role sent.")).toBeTruthy();
    expect(posts).toEqual([{ group: 3, roles: { desk: "follower", shelf: "leader" } }]);
    await waitFor(() => expect(screen.getByText("sends 3 · receives 1")).toBeTruthy());
  });
});
