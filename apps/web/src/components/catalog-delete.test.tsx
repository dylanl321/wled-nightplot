import {
  LED_CATALOG_DELETE_CAPTION,
  LED_CATALOG_DELETE_REFUSE_UNKNOWN,
  type CatalogDeleteCheck,
} from "@nightplot/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CatalogDelete } from "@/components/catalog-delete";
import { requestPath } from "@/test/fixtures";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const clearCheck: CatalogDeleteCheck = {
  key: "attaches",
  label: "Lights attach",
  status: "ok",
  detail: "No Lights attach this recipe. Removing it is catalog bookkeeping only.",
};

const blockedCheck: CatalogDeleteCheck = {
  key: "attaches",
  label: "Lights attach",
  status: "blocked",
  detail: "Garage still attaches this recipe. Detach on Strip first. There is no override.",
};

const unknownCheck: CatalogDeleteCheck = {
  key: "attaches",
  label: "Lights attach",
  status: "unknown",
  detail: LED_CATALOG_DELETE_REFUSE_UNKNOWN,
};

describe("CatalogDelete", () => {
  it("refuses while a Light attaches and does not look Done", async () => {
    const deletes: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/led-products/eave-cob/delete-checks")) {
        return jsonResponse({
          productId: "eave-cob",
          checks: [blockedCheck],
          attached: 1,
          caption: LED_CATALOG_DELETE_CAPTION,
        });
      }
      if (path.endsWith("/led-products/eave-cob") && init?.method === "DELETE") {
        deletes.push(path);
        return jsonResponse({ message: "should not delete" }, 500);
      }
      return jsonResponse({ message: "unexpected path" }, 500);
    });
    vi.stubGlobal("fetch", fetch);

    render(<CatalogDelete productId="eave-cob" label="Eave COB" onDeleted={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove recipe" }));

    await waitFor(() => {
      expect(screen.getByText(blockedCheck.detail)).toBeTruthy();
    });
    expect(screen.getByText("Remove · 0 of 1 checks")).toBeTruthy();
    expect(screen.getByText(/Unlocks when no Light attaches this recipe/)).toBeTruthy();
    expect(screen.queryByText(/All checks complete/i)).toBeNull();
    expect(screen.getByText(/not Hardware Done/i)).toBeTruthy();
    expect(deletes).toEqual([]);
  });

  it("clears only when the attach check is zero and DELETE succeeds", async () => {
    const deleted: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/led-products/eave-cob/delete-checks")) {
        return jsonResponse({
          productId: "eave-cob",
          checks: [clearCheck],
          attached: 0,
          caption: LED_CATALOG_DELETE_CAPTION,
        });
      }
      if (path.endsWith("/led-products/eave-cob") && init?.method === "DELETE") {
        return jsonResponse({
          deleted: true,
          attached: 0,
          product: { id: "eave-cob" },
          message: "Removed from the catalog. Not a WLED write, not Apply, not Hardware Done.",
        });
      }
      return jsonResponse({ message: "unexpected path" }, 500);
    });
    vi.stubGlobal("fetch", fetch);

    render(
      <CatalogDelete
        productId="eave-cob"
        label="Eave COB"
        onDeleted={(id) => {
          deleted.push(id);
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove recipe" }));

    await waitFor(() => {
      expect(screen.getByText(/No Lights attach this recipe/)).toBeTruthy();
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Remove recipe" })[0]!);

    await waitFor(() => {
      expect(deleted).toEqual(["eave-cob"]);
    });
  });

  it("keeps refuse chrome when DELETE says Lights still attach", async () => {
    const deleted: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/led-products/eave-cob/delete-checks")) {
        return jsonResponse({
          productId: "eave-cob",
          checks: [clearCheck],
          attached: 0,
          caption: LED_CATALOG_DELETE_CAPTION,
        });
      }
      if (path.endsWith("/led-products/eave-cob") && init?.method === "DELETE") {
        return jsonResponse(
          {
            error: "in_use",
            message: blockedCheck.detail,
            attached: 1,
            checks: [blockedCheck],
            caption: LED_CATALOG_DELETE_CAPTION,
          },
          409,
        );
      }
      return jsonResponse({ message: "unexpected path" }, 500);
    });
    vi.stubGlobal("fetch", fetch);

    render(
      <CatalogDelete
        productId="eave-cob"
        label="Eave COB"
        onDeleted={(id) => {
          deleted.push(id);
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove recipe" }));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Remove recipe" }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Remove recipe" })[0]!);

    await waitFor(() => {
      expect(screen.getByText(blockedCheck.detail)).toBeTruthy();
    });
    expect(deleted).toEqual([]);
    expect(screen.getByText("Remove · 0 of 1 checks")).toBeTruthy();
    expect(screen.queryByText(/All checks complete/i)).toBeNull();
  });

  it("treats unknown attach count as refuse, not clear", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(String(input));
      if (path.endsWith("/led-products/eave-cob/delete-checks")) {
        return jsonResponse({
          productId: "eave-cob",
          checks: [unknownCheck],
          attached: null,
          caption: LED_CATALOG_DELETE_CAPTION,
        });
      }
      return jsonResponse({ message: "unexpected path" }, 500);
    });
    vi.stubGlobal("fetch", fetch);

    render(<CatalogDelete productId="eave-cob" label="Eave COB" onDeleted={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove recipe" }));

    await waitFor(() => {
      expect(screen.getByText(LED_CATALOG_DELETE_REFUSE_UNKNOWN)).toBeTruthy();
    });
    expect(screen.getByText("Remove · 0 of 1 checks")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Removing…" })).toBeNull();
    expect(screen.queryByText(/All checks complete/i)).toBeNull();
  });
});
