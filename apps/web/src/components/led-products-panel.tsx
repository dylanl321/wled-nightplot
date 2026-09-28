"use client";

import {
  LED_CATALOG_ATTACH_COPY,
  LED_CATALOG_PER_LIGHT_COPY,
  LED_CATALOG_PER_LIGHT_HEADING,
  LED_CATALOG_SHARED_COPY,
  LED_CATALOG_SHARED_HEADING,
  LED_FORM_FACTORS,
  listStrips,
  type LedFormFactor,
  type LedProduct,
} from "@nightplot/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchJson, patchJson, postJson } from "@/lib/api";

type FormState = {
  id: string;
  label: string;
  notes: string;
  formFactor: LedFormFactor;
  driverId: string;
  defaultLength: string;
  defaultGpio: string;
  densityNotes: string;
};

const emptyForm = (): FormState => ({
  id: "",
  label: "",
  notes: "",
  formFactor: "discrete",
  driverId: listStrips()[0]?.id ?? "ws281x",
  defaultLength: "",
  defaultGpio: "",
  densityNotes: "",
});

function formFromProduct(product: LedProduct): FormState {
  return {
    id: product.id,
    label: product.label,
    notes: product.notes,
    formFactor: product.formFactor,
    driverId: product.driverId,
    defaultLength: product.defaultLength != null ? String(product.defaultLength) : "",
    defaultGpio: product.defaultGpio != null ? String(product.defaultGpio) : "",
    densityNotes: product.densityNotes ?? "",
  };
}

function formFactorLabel(value: LedFormFactor): string {
  if (value === "cob") return "COB";
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function driverLabel(driverId: string): string {
  return listStrips().find((row) => row.id === driverId)?.label ?? driverId;
}

function writeBody(form: FormState, extras: LedProduct | null, includeId: boolean) {
  const body: Record<string, unknown> = {
    label: form.label.trim(),
    notes: form.notes.trim(),
    formFactor: form.formFactor,
    driverId: form.driverId,
  };
  if (includeId) body.id = form.id.trim();
  if (form.defaultLength.trim()) {
    body.defaultLength = Number.parseInt(form.defaultLength, 10);
  }
  if (form.defaultGpio.trim()) {
    body.defaultGpio = Number.parseInt(form.defaultGpio, 10);
  }
  if (form.densityNotes.trim()) body.densityNotes = form.densityNotes.trim();
  if (extras?.channels) body.channels = extras.channels;
  if (extras?.colorOrder) body.colorOrder = extras.colorOrder;
  if (extras?.bead) body.bead = extras.bead;
  return body;
}

export function LedProductsPanel({
  initialProducts = [],
  loadError,
}: {
  initialProducts?: LedProduct[];
  loadError?: string;
}) {
  const [products, setProducts] = useState<LedProduct[]>(initialProducts);
  const [form, setForm] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "load" | null>(null);
  const [notice, setNotice] = useState<string | null>(loadError ?? null);

  function patchForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setNotice(null);
  }

  async function reload() {
    setBusy("load");
    setNotice(null);
    try {
      const payload = await fetchJson<{ products: LedProduct[] }>("/api/led-products");
      setProducts(payload.products ?? []);
    } catch (caught: unknown) {
      setNotice(caught instanceof Error ? caught.message : "LED products did not load.");
    } finally {
      setBusy(null);
    }
  }

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setNotice(null);
  }

  function startEdit(product: LedProduct) {
    setEditingId(product.id);
    setForm(formFromProduct(product));
    setNotice(null);
  }

  function cancelForm() {
    setForm(null);
    setEditingId(null);
    setNotice(null);
  }

  async function save() {
    if (!form) return;
    if (!editingId && !form.id.trim()) {
      setNotice("id must be a short slug (letters, numbers, . _ -).");
      return;
    }
    const extras = editingId ? (products.find((row) => row.id === editingId) ?? null) : null;
    setBusy("save");
    setNotice(null);
    const res = editingId
      ? await patchJson<{ product?: LedProduct }>("/api/led-products/" + editingId, {
          product: writeBody(form, extras, false),
        })
      : await postJson<{ product?: LedProduct }>("/api/led-products", {
          product: writeBody(form, null, true),
        });
    setBusy(null);
    if (!res.ok) {
      setNotice(res.data.message ?? "LED product was not saved.");
      return;
    }
    if (res.data.product) {
      const saved = res.data.product;
      setProducts((current) => {
        if (current.some((row) => row.id === saved.id)) {
          return current.map((row) => (row.id === saved.id ? saved : row));
        }
        return [...current, saved];
      });
    }
    setForm(null);
    setEditingId(null);
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6 px-5 py-8 sm:px-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em]">LED products</h1>
        <p className="text-muted-foreground">
          {LED_CATALOG_SHARED_HEADING} — {LED_CATALOG_SHARED_COPY}
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-[#0e1014] p-4">
        <p className="text-[13px] leading-5 text-[#c9c3b8]">{LED_CATALOG_ATTACH_COPY}</p>
        <p className="text-[13px] leading-5 text-[#c9c3b8]">
          <span className="font-semibold text-foreground">{LED_CATALOG_PER_LIGHT_HEADING}.</span>{" "}
          {LED_CATALOG_PER_LIGHT_COPY} Optional length and GPIO on a recipe are catalog
          suggestions — they fill Strip; this Light’s fields still override. Form factor is
          metadata — not written to WLED. A catalog row is not Hardware Done.
        </p>
      </div>

      {notice ? <p className="text-[13px] text-destructive">{notice}</p> : null}

      {form ? (
        <form
          className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h2 className="text-[18px] font-semibold">
            {editingId ? "Edit LED product" : "New LED product"}
          </h2>
          {editingId ? (
            <p className="font-mono text-[12px] text-quiet">id {editingId} — id does not change.</p>
          ) : (
            <label className="flex flex-col gap-2">
              <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
                Catalog id
              </span>
              <Input
                value={form.id}
                onChange={(event) => patchForm("id", event.target.value)}
                aria-label="Catalog id"
                autoComplete="off"
              />
              <span className="text-[12px] text-quiet">
                Short slug (letters, numbers, . _ -). Shared across Lights that attach this row.
              </span>
            </label>
          )}
          <label className="flex flex-col gap-2">
            <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
              Label
            </span>
            <Input
              value={form.label}
              onChange={(event) => patchForm("label", event.target.value)}
              aria-label="Label"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
              Notes
            </span>
            <textarea
              value={form.notes}
              onChange={(event) => patchForm("notes", event.target.value)}
              aria-label="Notes"
              rows={3}
              className="w-full rounded-md border border-input bg-[#07080a] px-2.5 py-2 font-sans text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
              Form factor
            </legend>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Form factor">
              {LED_FORM_FACTORS.map((formFactor) => {
                const selected = form.formFactor === formFactor;
                return (
                  <button
                    key={formFactor}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => patchForm("formFactor", formFactor)}
                    className={`h-10 rounded-md border px-3 text-[13px] font-semibold ${
                      selected
                        ? "border-primary bg-secondary text-foreground"
                        : "border-input bg-[#07080a] text-[#c9c3b8] hover:bg-secondary"
                    }`}
                  >
                    {formFactorLabel(formFactor)}
                  </button>
                );
              })}
            </div>
            <span className="text-[12px] text-quiet">Metadata. Not written to WLED.</span>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
              LED type / IC
            </legend>
            <div className="flex flex-wrap gap-2" role="group" aria-label="LED type / IC">
              {listStrips().map((driver) => {
                const selected = form.driverId === driver.id;
                return (
                  <button
                    key={driver.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => patchForm("driverId", driver.id)}
                    className={`h-10 rounded-md border px-3 text-[13px] font-semibold ${
                      selected
                        ? "border-primary bg-secondary text-foreground"
                        : "border-input bg-[#07080a] text-[#c9c3b8] hover:bg-secondary"
                    }`}
                  >
                    {driver.label}
                  </button>
                );
              })}
            </div>
            <span className="text-[12px] text-quiet">
              Shared recipe. Registered drivers only. A slot is not Hardware Done.
            </span>
          </fieldset>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
                Suggested length
              </span>
              <Input
                inputMode="numeric"
                value={form.defaultLength}
                onChange={(event) => patchForm("defaultLength", event.target.value)}
                aria-label="Suggested node count"
              />
              <span className="text-[12px] text-quiet">
                Catalog suggestion. This Light sets length on Strip.
              </span>
            </label>
            <label className="flex flex-col gap-2">
              <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
                Suggested GPIO
              </span>
              <Input
                inputMode="numeric"
                value={form.defaultGpio}
                onChange={(event) => patchForm("defaultGpio", event.target.value)}
                aria-label="Suggested GPIO"
              />
              <span className="text-[12px] text-quiet">
                Catalog suggestion. This Light sets GPIO on Strip.
              </span>
            </label>
          </div>
          <label className="flex flex-col gap-2">
            <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
              Density notes
            </span>
            <Input
              value={form.densityNotes}
              onChange={(event) => patchForm("densityNotes", event.target.value)}
              aria-label="Density notes"
            />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={cancelForm} disabled={busy !== null}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy !== null}>
              {busy === "save" ? "Saving…" : editingId ? "Save recipe" : "Create recipe"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button onClick={startCreate} disabled={busy !== null}>
              New LED product
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void reload()}
              disabled={busy !== null}
            >
              {busy === "load" ? "Loading…" : "Reload"}
            </Button>
          </div>
          {products.length === 0 ? (
            <p className="text-[13px] text-quiet">
              No LED products in the catalog. Create a shared recipe, then attach it on Strip.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {products.map((product) => (
                <li
                  key={product.id}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-card px-[18px] py-4 sm:flex-row sm:items-start"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-base font-medium">{product.label}</span>
                    <span className="font-mono text-[11px] text-quiet">{product.id}</span>
                    <span className="text-[13px] leading-5 text-[#c9c3b8]">
                      {driverLabel(product.driverId)} · {formFactorLabel(product.formFactor)}
                      {product.defaultLength != null
                        ? ` · suggested ${product.defaultLength} nodes`
                        : ""}
                      {product.defaultGpio != null ? ` · GPIO ${product.defaultGpio}` : ""}
                    </span>
                    {product.notes ? (
                      <span className="text-[12px] leading-5 text-quiet">{product.notes}</span>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="sm:ml-auto"
                    onClick={() => startEdit(product)}
                    disabled={busy !== null}
                  >
                    Edit
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
