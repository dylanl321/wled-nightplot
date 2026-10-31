import { DEFAULT_LOOKS, DEFAULT_PLAYLIST, LOOK_CAPTION, defaultWireframeSpec, type ApplyResult, type LightDetail } from "@nightplot/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WireframeFlow } from "./wireframe-flow";
import { lightDetail, lightView, requestPath } from "@/test/fixtures";

function detail(overrides: Partial<LightDetail> = {}): LightDetail {
  return lightDetail({
    light: lightView({
      name: "Garage",
      reachability: "online",
      on: true,
      brightness: 180,
      ledCount: 60,
    }),
    elements: [],
    props: [],
    ...overrides,
  });
}

function appliedWireframe(): LightDetail & { apply: ApplyResult; prop: { id: string; label: string; kind: string } } {
  return {
    ...detail({
      elements: [{ id: "well-face-0", lightId: "light-garage", label: "Well house · face 1", start: 0, stop: 8 }],
      props: [{
        id: "prop-well",
        lightId: "light-garage",
        label: "Well house",
        kind: "wireframe",
        elementIds: ["well-face-0"],
        wireframe: defaultWireframeSpec(),
      }],
    }),
    apply: {
      status: "matched",
      matched: true,
      rows: [],
      sent: [],
      read: [],
      message: "Controller reports the ranges we sent.",
      caption: "Software-green from the fixture. Not Hardware Done.",
    },
    prop: { id: "prop-well", label: "Well house", kind: "wireframe" },
  };
}

function stubApi(writes: { path: string; body: unknown }[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (init?.method && init.method !== "GET") writes.push({ path, body });
      if (path === "/api/looks" && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({
          version: 1,
          looks: DEFAULT_LOOKS,
          playlists: [DEFAULT_PLAYLIST],
          schedule: null,
          yard: { lights: [], props: [], elements: [] },
          caption: LOOK_CAPTION,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (path === "/api/looks" && init?.method === "PUT") {
        return new Response(JSON.stringify({
          version: 1,
          looks: body.looks,
          playlists: body.playlists,
          schedule: body.schedule,
          yard: { lights: [], props: [], elements: [] },
          caption: LOOK_CAPTION,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (path.includes("/props")) {
        return new Response(JSON.stringify(appliedWireframe()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(detail()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

function renderFlow(phase: "draw" | "lock" = "draw") {
  const writes: { path: string; body: unknown }[] = [];
  const applied = vi.fn();
  const closed = vi.fn();
  stubApi(writes);
  render(
    <WireframeFlow
      lightId="light-garage"
      lightName="Garage"
      ledCount={60}
      rgbw={false}
      unreachable={false}
      initialLabel="Well house"
      initialPhase={phase}
      onClose={closed}
      onApplied={applied}
    />,
  );
  return { writes, applied, closed };
}

function tapClass(name: string): string {
  return (screen.getByRole("button", { name }) as HTMLButtonElement).className;
}

describe("Wireframe flow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is a phone overlay: no horizontal overflow, 44px targets, thumb nudges", () => {
    renderFlow("lock");
    const dialog = screen.getByRole("dialog", { name: "Wireframe on Garage" });
    expect(dialog.className).toMatch(/overflow-hidden/);
    expect(dialog.className).toMatch(/max-w-\[100vw\]/);
    expect(dialog.className).toMatch(/overscroll-x-none/);
    expect(screen.getByLabelText("Thumb nudge")).toBeTruthy();
    expect(tapClass("−1")).toMatch(/min-h-11/);
    expect(tapClass("+5")).toMatch(/min-h-11/);
    expect(tapClass("Previous LED")).toMatch(/min-h-14/);
    expect(tapClass("Lock this corner")).toMatch(/min-h-16/);
    expect(tapClass("Cancel")).toMatch(/min-h-11/);
  });

  it("locks from the locate cursor without a drawn line and Applies", async () => {
    const { writes, applied } = renderFlow("lock");
    const dialog = screen.getByRole("dialog", { name: "Wireframe on Garage" });
    fireEvent.click(within(dialog).getByRole("button", { name: "+5" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Lock this corner" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Review this wireframe" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply this Prop" }));
    await waitFor(() => {
      expect(writes.some((write) => (
        write.path.endsWith("/props") &&
        (write.body as { kind?: string }).kind === "wireframe" &&
        (write.body as { apply?: boolean }).apply === true
      ))).toBe(true);
    });
    const body = writes.find((write) => write.path.endsWith("/props"))?.body as {
      wireframe: { path: null | object; locks: { physicalIndex: number }[] };
    };
    expect(body.wireframe.path).toBeNull();
    expect(body.wireframe.locks[0]?.physicalIndex).toBe(5);
    expect(applied).toHaveBeenCalled();
    expect(await screen.findByRole("img", { name: "Unfolded box+X net" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Colour face 1" }));
    await waitFor(() => {
      expect(writes.some((write) => write.path === "/api/looks")).toBe(true);
    });
  });

  it("keeps the draw net inside the phone column", () => {
    renderFlow("draw");
    const dialog = screen.getByRole("dialog", { name: "Wireframe on Garage" });
    const net = within(dialog).getByRole("img", { name: "Unfolded box+X net" });
    expect(net.className).toMatch(/overflow-hidden/);
    expect(tapClass("Lock corners on the strip")).toMatch(/min-h-16/);
    expect(tapClass("Fewer sides")).toMatch(/min-h-11/);
    expect(tapClass("Reset net view")).toMatch(/min-h-11/);
  });
});
