import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PropList } from "./prop-list";
import { lightDetail, requestPath } from "@/test/fixtures";

describe("Prop list", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renames a Prop on the controller list", async () => {
    const onDetail = vi.fn();
    const writes: { path: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(String(input));
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (init?.method === "PATCH") writes.push({ path, body });
        return new Response(JSON.stringify(lightDetail({
          props: [{
            id: "prop-1",
            lightId: "light-garage",
            label: "Kitchen",
            kind: "window",
            elementIds: ["el-door"],
          }],
          elements: [{ id: "el-door", lightId: "light-garage", label: "Kitchen · top", start: 0, stop: 20 }],
        })), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    render(
      <PropList
        lightId="light-garage"
        lightName="Garage"
        ledCount={60}
        rgbw={false}
        unreachable={false}
        props={[{
          id: "prop-1",
          lightId: "light-garage",
          label: "Front window",
          kind: "window",
          elementIds: ["el-door"],
        }]}
        elements={[{ id: "el-door", lightId: "light-garage", label: "Front window · top", start: 0, stop: 20 }]}
        disabled={false}
        onAdd={vi.fn()}
        onDetail={onDetail}
        onNotice={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Rename Front window"), { target: { value: "Kitchen" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(writes[0]?.body).toEqual({ label: "Kitchen" }));
    expect(onDetail).toHaveBeenCalled();
  });
});
