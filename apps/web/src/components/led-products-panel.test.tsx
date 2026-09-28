import {
  LED_CATALOG_ATTACH_COPY,
  LED_CATALOG_PER_LIGHT_COPY,
  LED_CATALOG_PER_LIGHT_HEADING,
  LED_CATALOG_SHARED_COPY,
  LED_CATALOG_SHARED_HEADING,
  seedLedProductsFromPresets,
  type LedProduct,
} from "@nightplot/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LedProductsPanel } from "@/components/led-products-panel";
import { requestPath } from "@/test/fixtures";

const catalog = seedLedProductsFromPresets();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("LED products catalog", () => {
  it("lists recipes and names shared catalog vs this Light", () => {
    render(<LedProductsPanel initialProducts={catalog} />);

    expect(screen.getByRole("heading", { name: "LED products" })).toBeTruthy();
    expect(screen.getByText(new RegExp(LED_CATALOG_SHARED_HEADING))).toBeTruthy();
    expect(screen.getByText(new RegExp(LED_CATALOG_SHARED_COPY))).toBeTruthy();
    expect(screen.getByText(LED_CATALOG_ATTACH_COPY)).toBeTruthy();
    expect(screen.getAllByText(LED_CATALOG_PER_LIGHT_HEADING, { exact: false }).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(new RegExp(LED_CATALOG_PER_LIGHT_COPY))).toBeTruthy();
    expect(screen.getAllByText(/not Hardware Done/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Create and edit write the shared recipe only/)).toBeTruthy();
    expect(
      screen.getByText((content) => content.includes("Unknown or partial attach counts refuse")),
    ).toBeTruthy();
    expect(screen.getByText(catalog[0]!.label)).toBeTruthy();
    expect(screen.getByRole("button", { name: "New LED product" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Remove recipe" }).length).toBe(catalog.length);
  });

  it("creates a recipe via POST and does not write WLED", async () => {
    const posts: unknown[] = [];
    const created: LedProduct = {
      id: "eave-cob",
      label: "Eave COB",
      notes: "Shared recipe. Not written to WLED.",
      formFactor: "cob",
      driverId: "ws281x",
      defaultLength: 120,
      defaultGpio: 16,
    };
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/led-products") && init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return jsonResponse({ product: created }, 201);
      }
      return jsonResponse({ message: "unexpected path" }, 500);
    });
    vi.stubGlobal("fetch", fetch);

    render(<LedProductsPanel initialProducts={catalog} />);
    fireEvent.click(screen.getByRole("button", { name: "New LED product" }));
    fireEvent.change(screen.getByLabelText("Catalog id"), { target: { value: "eave-cob" } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Eave COB" } });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Shared recipe. Not written to WLED." },
    });
    fireEvent.click(screen.getByRole("button", { name: "COB" }));
    fireEvent.change(screen.getByLabelText("Suggested node count"), {
      target: { value: "120" },
    });
    fireEvent.change(screen.getByLabelText("Suggested GPIO"), { target: { value: "16" } });
    fireEvent.click(screen.getByRole("button", { name: "Create recipe" }));

    await waitFor(() => {
      expect(posts).toEqual([
        {
          product: {
            id: "eave-cob",
            label: "Eave COB",
            notes: "Shared recipe. Not written to WLED.",
            formFactor: "cob",
            driverId: "ws281x",
            defaultLength: 120,
            defaultGpio: 16,
          },
        },
      ]);
    });
    expect(screen.getByText("Eave COB")).toBeTruthy();
    expect(fetch.mock.calls.every((call) => !String(call[0]).includes("/provision"))).toBe(true);
  });

  it("edits a recipe via PATCH and keeps the catalog id", async () => {
    const product = catalog[0]!;
    const patches: { path: string; body: unknown }[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith(`/led-products/${product.id}`) && init?.method === "PATCH") {
        patches.push({ path, body: JSON.parse(String(init.body)) });
        return jsonResponse({
          product: { ...product, label: "Porch WS281x revised" },
        });
      }
      return jsonResponse({ message: "unexpected path" }, 500);
    });
    vi.stubGlobal("fetch", fetch);

    render(<LedProductsPanel initialProducts={catalog} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    expect(screen.getByText(new RegExp(`id ${product.id}`))).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Porch WS281x revised" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));

    await waitFor(() => {
      expect(patches).toHaveLength(1);
    });
    expect(patches[0]?.path).toContain(`/led-products/${product.id}`);
    expect(patches[0]?.body).toMatchObject({
      product: {
        label: "Porch WS281x revised",
        formFactor: product.formFactor,
        driverId: product.driverId,
      },
    });
    expect((patches[0]?.body as { product: { id?: string } }).product.id).toBeUndefined();
    expect(screen.getByText("Porch WS281x revised")).toBeTruthy();
  });

  it("asks for section length on COB and keeps voltage under Advanced", () => {
    render(<LedProductsPanel initialProducts={catalog} />);
    fireEvent.click(screen.getByRole("button", { name: "New LED product" }));
    expect(screen.getByLabelText("Pitch")).toBeTruthy();
    expect(screen.queryByLabelText("Section length")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "COB" }));
    expect(screen.getByLabelText("Section length")).toBeTruthy();
    expect(screen.queryByLabelText("Pitch")).toBeNull();
    expect(screen.getByText("Advanced")).toBeTruthy();
    const advanced = screen.getByText("Advanced").closest("details");
    expect(advanced?.open).toBe(false);
  });
});
