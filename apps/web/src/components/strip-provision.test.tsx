import type { LightDetail as LightDetailPayload, ProvisionRead } from "@nightplot/shared";
import {
  LED_CATALOG_ATTACH_COPY,
  LED_CATALOG_PER_LIGHT_COPY,
  LED_CATALOG_PER_LIGHT_HEADING,
  LED_CATALOG_SHARED_COPY,
  LED_CATALOG_SHARED_HEADING,
  provisionApplyBodyFromProduct,
  seedLedProductsFromPresets,
  stripColorOrderCopy,
} from "@nightplot/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LightDetail } from "@/components/light-detail";
import { StripProvisionPanel } from "@/components/strip-provision";
import { lightDetail, lightView, requestPath } from "@/test/fixtures";

const catalogProducts = seedLedProductsFromPresets();

const CFG_MISMATCH_MESSAGE =
  "Wrote, but /json/cfg did not match. Not treating as success.";
const DIDNT_STICK_MESSAGE = "Apply didn’t stick. Your draft is kept.";
const CFG_REFUSE_MESSAGE =
  "This firmware isn’t in the strip compatibility table. Nothing was written.";
const BUILD_REFUSE_MESSAGE = "No LED bus on this firmware. Nothing was written.";

const provision: ProvisionRead = {
  settings: {
    ledType: "ws281x",
    length: 60,
    gpio: 16,
    nativeType: 22,
    nativeOrder: 0,
    colorOrder: "GRB",
  },
  fingerprint: {
    firmware: "WLED 0.15.4",
    source: "cfg",
    writable: true,
    mappingId: "wled-0.15-ws281x-rgb-grb",
    fields: ["ledType", "length", "gpio"],
  },
  caption: "Software-green from the fixture. Not Hardware Done.",
  refuse: null,
  buses: 1,
};

const sk6812RgbwProvision: ProvisionRead = {
  ...provision,
  settings: {
    ledType: "sk6812-rgbw",
    length: 60,
    gpio: 16,
    nativeType: 30,
    nativeOrder: 1,
    colorOrder: "RGBW",
  },
  fingerprint: {
    ...provision.fingerprint,
    mappingId: "wled-0.15-sk6812-rgbw-grbw",
  },
};

function payload(overrides: Partial<LightDetailPayload> = {}): LightDetailPayload {
  return {
    ...lightDetail({
      light: lightView({
        reachability: "online",
        on: true,
        brightness: 128,
        bead: "#ffa000",
      }),
    }),
    provision,
    ledProducts: catalogProducts,
    ...overrides,
  } as LightDetailPayload & { ledProducts: typeof catalogProducts };
}

describe("Strip provision", () => {
  it("offers Strip on an enrolled Light", () => {
    render(<LightDetail initial={payload()} mode="inspect" />);
    expect(screen.getByRole("button", { name: "Strip" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /type, length, GPIO/ })).toBeTruthy();
  });

  it("names shared catalog vs this Light and links to LED products", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(String(input));
      if (path.endsWith("/provision")) {
        return new Response(JSON.stringify(payload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<StripProvisionPanel lightId="light-garage" unreachable={false} />);

    expect(await screen.findByText(LED_CATALOG_SHARED_HEADING)).toBeTruthy();
    expect(screen.getByText(LED_CATALOG_SHARED_COPY)).toBeTruthy();
    expect(screen.getByText(LED_CATALOG_ATTACH_COPY)).toBeTruthy();
    expect(screen.getByRole("heading", { name: LED_CATALOG_PER_LIGHT_HEADING })).toBeTruthy();
    expect(screen.getByText(LED_CATALOG_PER_LIGHT_COPY)).toBeTruthy();
    const manage = screen.getByRole("link", { name: "Manage LED products" });
    expect(manage.getAttribute("href")).toBe("/led-products");
    expect(screen.getByRole("button", { name: "Manual fields" })).toBeTruthy();
  });

  it("keeps a write→reread mismatch on the failure UI", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/provision") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            ...payload(),
            provisionWrite: {
              status: "mismatch",
              matched: false,
              sent: { ledType: "ws281x", length: 150, gpio: 2 },
              read: {
                ledType: "ws281x",
                length: 60,
                gpio: 16,
                nativeType: 22,
                nativeOrder: 0,
                colorOrder: "GRB",
              },
              snapshotLedCount: 60,
              fingerprint: provision.fingerprint,
              message: CFG_MISMATCH_MESSAGE,
              caption: provision.caption,
            },
            message: CFG_MISMATCH_MESSAGE,
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.endsWith("/provision")) {
        return new Response(JSON.stringify(payload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<StripProvisionPanel lightId="light-garage" unreachable={false} />);

    expect(await screen.findByRole("button", { name: "Apply" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    const title = await screen.findByText(CFG_MISMATCH_MESSAGE);
    expect(title.tagName).toBe("SPAN");
    expect(title.textContent).not.toMatch(/didn’t stick/);
    expect(screen.queryByText("Apply didn’t stick")).toBeNull();
    expect(screen.queryByText(DIDNT_STICK_MESSAGE)).toBeNull();
    expect(screen.getByText(/ws281x · 150 nodes · GPIO 2/)).toBeTruthy();
    expect(screen.getByText(/Not treating as success/)).toBeTruthy();
    expect(screen.getByText(/Not Hardware Done/)).toBeTruthy();
    expect(screen.queryByText("Controller reports the strip we sent.")).toBeNull();

    await waitFor(() => {
      const posts = fetch.mock.calls.filter((call) => {
        const init = call[1] as RequestInit | undefined;
        return init?.method === "POST";
      });
      expect(posts.length).toBe(1);
    });
  });

  it("still titles a didn’t-stick provision message as that copy", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/provision") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            ...payload(),
            provisionWrite: {
              status: "failed",
              matched: false,
              sent: { ledType: "ws281x", length: 150, gpio: 2 },
              read: {
                ledType: "ws281x",
                length: 60,
                gpio: 16,
                nativeType: 22,
                nativeOrder: 0,
                colorOrder: "GRB",
              },
              snapshotLedCount: 60,
              fingerprint: provision.fingerprint,
              message: DIDNT_STICK_MESSAGE,
              caption: provision.caption,
            },
            message: DIDNT_STICK_MESSAGE,
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.endsWith("/provision")) {
        return new Response(JSON.stringify(payload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<StripProvisionPanel lightId="light-garage" unreachable={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));

    const title = await screen.findByText(DIDNT_STICK_MESSAGE);
    expect(title.tagName).toBe("SPAN");
    expect(screen.queryByText(CFG_MISMATCH_MESSAGE)).toBeNull();
    expect(screen.queryByText(CFG_REFUSE_MESSAGE)).toBeNull();
  });

  it("titles a cfg-refuse from the write message — not Apply didn’t stick", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/provision") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            ...payload(),
            provisionWrite: {
              status: "refused",
              matched: false,
              sent: { ledType: "ws281x", length: 60, gpio: 16 },
              read: provision.settings,
              snapshotLedCount: 60,
              fingerprint: provision.fingerprint,
              message: CFG_REFUSE_MESSAGE,
              caption: provision.caption,
            },
            message: CFG_REFUSE_MESSAGE,
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.endsWith("/provision")) {
        return new Response(JSON.stringify(payload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<StripProvisionPanel lightId="light-garage" unreachable={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));

    const title = await screen.findByText(CFG_REFUSE_MESSAGE);
    expect(title.tagName).toBe("SPAN");
    expect(title.textContent).not.toMatch(/didn’t stick/);
    expect(screen.queryByText("Apply didn’t stick")).toBeNull();
    expect(screen.queryByText(DIDNT_STICK_MESSAGE)).toBeNull();
    expect(screen.queryByText(CFG_MISMATCH_MESSAGE)).toBeNull();
  });

  it("titles a buildProvisionWrite refuse from provisionWrite — failure panel, not notice-only", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/provision") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            ...payload(),
            provisionWrite: {
              status: "refused",
              matched: false,
              sent: { ledType: "ws281x", length: 80, gpio: 2 },
              read: provision.settings,
              snapshotLedCount: 60,
              fingerprint: provision.fingerprint,
              message: BUILD_REFUSE_MESSAGE,
              caption: provision.caption,
            },
            message: BUILD_REFUSE_MESSAGE,
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.endsWith("/provision")) {
        return new Response(JSON.stringify(payload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<StripProvisionPanel lightId="light-garage" unreachable={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));

    const title = await screen.findByText(BUILD_REFUSE_MESSAGE);
    expect(title.tagName).toBe("SPAN");
    expect(title.textContent).not.toMatch(/didn’t stick/);
    expect(screen.getByText("Sent")).toBeTruthy();
    expect(screen.getByText(/ws281x · 80 nodes · GPIO 2/)).toBeTruthy();
    expect(screen.getByText("Read back")).toBeTruthy();
    expect(screen.queryByText("Apply didn’t stick")).toBeNull();
    expect(screen.queryByText(DIDNT_STICK_MESSAGE)).toBeNull();
    expect(screen.queryByText(CFG_MISMATCH_MESSAGE)).toBeNull();
    expect(screen.queryByText(CFG_REFUSE_MESSAGE)).toBeNull();
    expect(screen.getByText(/Not Hardware Done/)).toBeTruthy();
  });

  it("fills the form from a catalog product, persists attach, and Apply posts provision only", async () => {
    const product = catalogProducts.find((row) => row.id === "led-ws281x-300-gpio2")!;
    const applyBody = provisionApplyBodyFromProduct(product);
    expect(applyBody.ok).toBe(true);
    if (!applyBody.ok) return;
    const posts: unknown[] = [];
    const attaches: unknown[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/led-product") && init?.method === "PATCH") {
        attaches.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({
            ...payload({ light: lightView({ ledProductId: product.id }) }),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.endsWith("/provision") && init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({
            ...payload({ light: lightView({ ledProductId: product.id }) }),
            provisionWrite: {
              status: "matched",
              matched: true,
              sent: applyBody.body.provision,
              read: {
                ledType: applyBody.body.provision.ledType,
                length: applyBody.body.provision.length,
                gpio: applyBody.body.provision.gpio,
                nativeType: 22,
                nativeOrder: 0,
                colorOrder: "GRB",
              },
              snapshotLedCount: applyBody.body.provision.length,
              fingerprint: provision.fingerprint,
              message: "Controller reports the strip we sent.",
              caption: provision.caption,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.endsWith("/provision")) {
        return new Response(JSON.stringify(payload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<StripProvisionPanel lightId="light-garage" unreachable={false} />);

    expect(await screen.findByRole("button", { name: product.label })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manual fields" })).toBeTruthy();
    expect((screen.getByLabelText("Node count") as HTMLInputElement).value).toBe("60");
    expect((screen.getByLabelText("GPIO pin") as HTMLInputElement).value).toBe("16");

    fireEvent.click(screen.getByRole("button", { name: product.label }));

    await waitFor(() => {
      expect((screen.getByLabelText("Node count") as HTMLInputElement).value).toBe(
        String(product.defaultLength),
      );
      expect((screen.getByLabelText("GPIO pin") as HTMLInputElement).value).toBe(
        String(product.defaultGpio),
      );
    });
    expect(screen.getByRole("button", { name: product.label }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await waitFor(() => {
      expect(attaches).toEqual([{ ledProductId: product.id }]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(posts).toEqual([applyBody.body]);
    });
  });

  it("lets fields override a selected product before Apply; product stays attached", async () => {
    const product = catalogProducts[1]!;
    const posts: unknown[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/led-product") && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({
            ...payload({ light: lightView({ ledProductId: product.id }) }),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.endsWith("/provision") && init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({
            ...payload({ light: lightView({ ledProductId: product.id }) }),
            message: "Strip provision was not written.",
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.endsWith("/provision")) {
        return new Response(JSON.stringify(payload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<StripProvisionPanel lightId="light-garage" unreachable={false} />);
    fireEvent.click(await screen.findByRole("button", { name: product.label }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: product.label }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect((screen.getByLabelText("Node count") as HTMLInputElement).value).toBe(
        String(product.defaultLength),
      );
    });
    fireEvent.change(screen.getByLabelText("Node count"), { target: { value: "180" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(posts).toEqual([
        { provision: { ledType: "ws281x", length: 180, gpio: product.defaultGpio } },
      ]);
    });
    expect(screen.getByRole("button", { name: product.label }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("posts SK6812 RGBW when that type is selected", async () => {
    const posts: unknown[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/provision") && init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({
            ...payload(),
            provision: {
              ...provision,
              settings: {
                ledType: "sk6812-rgbw",
                length: 60,
                gpio: 16,
                nativeType: 30,
                nativeOrder: 0,
                colorOrder: "GRBW",
              },
              fingerprint: {
                ...provision.fingerprint,
                mappingId: "wled-0.15-sk6812-rgbw-grbw",
              },
            },
            provisionWrite: {
              status: "matched",
              matched: true,
              sent: { ledType: "sk6812-rgbw", length: 60, gpio: 16 },
              read: {
                ledType: "sk6812-rgbw",
                length: 60,
                gpio: 16,
                nativeType: 30,
                nativeOrder: 0,
                colorOrder: "GRBW",
              },
              snapshotLedCount: 60,
              fingerprint: provision.fingerprint,
              message: "Controller reports the strip we sent.",
              caption: provision.caption,
              orderPreserved: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.endsWith("/provision")) {
        return new Response(JSON.stringify(payload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<StripProvisionPanel lightId="light-garage" unreachable={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "SK6812 RGBW" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(posts).toEqual([
        { provision: { ledType: "sk6812-rgbw", length: 60, gpio: 16 } },
      ]);
    });
    expect(screen.getByText("Controller reports the strip we sent.")).toBeTruthy();
    expect(screen.getByText("Colour order on this bus: GRBW.")).toBeTruthy();
    expect(screen.getByText("Strip does not pick colour order.")).toBeTruthy();
    expect(screen.queryByText(/not GRBW/)).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("shows the Element rewrite story after a length-changing Apply", async () => {
    const after = payload({
      light: lightView({
        reachability: "online",
        on: true,
        brightness: 128,
        bead: "#ffa000",
        ledCount: 30,
        elementCount: 1,
        driftLabel: null,
      }),
      elements: [{ id: "el-door", lightId: "light-garage", label: "Door", start: 0, stop: 30 }],
    });
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/provision") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            ...after,
            provision: {
              ...provision,
              settings: { ...provision.settings, length: 30 },
            },
            provisionWrite: {
              status: "matched",
              matched: true,
              sent: { ledType: "ws281x", length: 30, gpio: 16 },
              read: {
                ledType: "ws281x",
                length: 30,
                gpio: 16,
                nativeType: 22,
                nativeOrder: 0,
                colorOrder: "GRB",
              },
              snapshotLedCount: 30,
              fingerprint: provision.fingerprint,
              message: "Controller reports the strip we sent.",
              caption: provision.caption,
              ranges: {
                previousLedCount: 60,
                nextLedCount: 30,
                kind: "shrink",
                rewritten: true,
                clipped: [
                  {
                    id: "el-door",
                    label: "Door",
                    start: 0,
                    previousStop: 60,
                    stop: 30,
                  },
                ],
                dropped: [],
                uncovered: [],
                notes: [
                  "Door 0–60 was clipped to 0–30. It ran past the new strip (30 LEDs).",
                ],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.endsWith("/provision")) {
        return new Response(JSON.stringify(payload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<StripProvisionPanel lightId="light-garage" unreachable={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));

    expect(await screen.findByText("Controller reports the strip we sent.")).toBeTruthy();
    expect(
      screen.getByText("Door 0–60 was clipped to 0–30. It ran past the new strip (30 LEDs)."),
    ).toBeTruthy();
  });

  it("adopts rewritten Elements on the open Light after Strip Apply", async () => {
    const initial = payload({
      light: lightView({
        reachability: "online",
        on: true,
        brightness: 128,
        bead: "#ffa000",
        ledCount: 60,
        elementCount: 1,
      }),
      elements: [{ id: "el-door", lightId: "light-garage", label: "Door", start: 0, stop: 60 }],
    });
    const after: LightDetailPayload = {
      ...initial,
      light: { ...initial.light, ledCount: 30 },
      elements: [{ id: "el-door", lightId: "light-garage", label: "Door", start: 0, stop: 30 }],
      reported: [{ start: 0, stop: 30, differs: false }],
      display: {
        declared: [
          {
            id: "el-door",
            label: "Door",
            start: 0,
            stop: 30,
            length: 30,
            differs: false,
            error: false,
          },
        ],
        reported: [{ start: 0, stop: 30, differs: false }],
        regions: [],
        notes: [],
      },
    };

    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/provision") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            ...after,
            provision: {
              ...provision,
              settings: { ...provision.settings, length: 30 },
            },
            provisionWrite: {
              status: "matched",
              matched: true,
              sent: { ledType: "ws281x", length: 30, gpio: 16 },
              read: {
                ledType: "ws281x",
                length: 30,
                gpio: 16,
                nativeType: 22,
                nativeOrder: 0,
                colorOrder: "GRB",
              },
              snapshotLedCount: 30,
              fingerprint: provision.fingerprint,
              message: "Controller reports the strip we sent.",
              caption: provision.caption,
              ranges: {
                previousLedCount: 60,
                nextLedCount: 30,
                kind: "shrink",
                rewritten: true,
                clipped: [
                  {
                    id: "el-door",
                    label: "Door",
                    start: 0,
                    previousStop: 60,
                    stop: 30,
                  },
                ],
                dropped: [],
                uncovered: [],
                notes: [
                  "Door 0–60 was clipped to 0–30. It ran past the new strip (30 LEDs).",
                ],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.endsWith("/provision")) {
        return new Response(JSON.stringify({ ...initial, provision }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path === `/api/lights/${initial.light.id}`) {
        return new Response(JSON.stringify(after), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<LightDetail initial={initial} mode="strip" />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));
    expect(
      await screen.findByText("Door 0–60 was clipped to 0–30. It ran past the new strip (30 LEDs)."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit ranges" }));
    expect((await screen.findAllByText("0–30")).length).toBeGreaterThan(0);
    expect(screen.queryByText("0–60")).toBeNull();
  });

  it("names a live non-GRBW SK6812 order on Strip without a picker", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(String(input));
      if (path.endsWith("/provision")) {
        return new Response(JSON.stringify(payload({ provision: sk6812RgbwProvision })), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<StripProvisionPanel lightId="light-garage" unreachable={false} />);
    expect(await screen.findByText(stripColorOrderCopy(sk6812RgbwProvision.settings))).toBeTruthy();
    expect(screen.getByText(/not GRBW/)).toBeTruthy();
    expect(screen.getByText("Strip does not pick colour order.")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /^(GRB|RGB|BRG|RBG|GBR|BGR)W?$/i })).toBeNull();
  });

  it("names the preserved non-GRBW order after a same-type Apply", async () => {
    const after = {
      ...sk6812RgbwProvision,
      settings: { ...sk6812RgbwProvision.settings, length: 90 },
    };
    const kept = stripColorOrderCopy({
      colorOrder: "RGBW",
      ledType: "sk6812-rgbw",
      afterSameTypeApply: true,
    });
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/provision") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            ...payload({ provision: after }),
            provisionWrite: {
              status: "matched",
              matched: true,
              sent: { ledType: "sk6812-rgbw", length: 90, gpio: 16 },
              read: after.settings,
              snapshotLedCount: 90,
              fingerprint: after.fingerprint,
              message: "Controller reports the strip we sent.",
              caption: after.caption,
              orderPreserved: true,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.endsWith("/provision")) {
        return new Response(JSON.stringify(payload({ provision: sk6812RgbwProvision })), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<StripProvisionPanel lightId="light-garage" unreachable={false} />);
    fireEvent.change(await screen.findByLabelText("Node count"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByText("Controller reports the strip we sent.")).toBeTruthy();
    expect(screen.getByText(kept)).toBeTruthy();
    expect(screen.getByText(/Apply kept the order already on the box/)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByLabelText(/colour order/i)).toBeNull();
  });
});
