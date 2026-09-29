"use client";

import {
  LED_CATALOG_ATTACH_COPY,
  LED_CATALOG_DELETE_COPY,
  LED_CATALOG_PER_LIGHT_COPY,
  LED_CATALOG_PER_LIGHT_HEADING,
  LED_CATALOG_SHARED_COPY,
  LED_CATALOG_SHARED_HEADING,
  LED_DENSITIES_PER_METER,
  LED_DENSITY_PER_METER_MAX,
  LED_FORM_FACTORS,
  LED_IP_RATINGS,
  LED_SPACING_MM_MAX,
  LED_VOLTAGES,
  LED_WATTS_PER_METER_MAX,
  LED_WIDTH_MM_MAX,
  formatNodeLength,
  ledProductSpacing,
  listStrips,
  PHYSICAL_LENGTH_CAPTION,
  type LedFormFactor,
  type LedProduct,
} from "@nightplot/shared";
import { useState } from "react";
import { CatalogDelete } from "@/components/catalog-delete";
import { LedLoader } from "@/components/ui/led-loader";
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
  pitchMm: string;
  ledsPerMeter: string;
  sectionLengthMm: string;
  voltage: string;
  wattsPerMeter: string;
  ipRating: string;
  widthMm: string;
  cutLengthMm: string;
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
  pitchMm: "",
  ledsPerMeter: "",
  sectionLengthMm: "",
  voltage: "",
  wattsPerMeter: "",
  ipRating: "",
  widthMm: "",
  cutLengthMm: "",
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
    pitchMm: product.pitchMm != null ? String(product.pitchMm) : "",
    ledsPerMeter: product.ledsPerMeter != null ? String(product.ledsPerMeter) : "",
    sectionLengthMm: product.sectionLengthMm != null ? String(product.sectionLengthMm) : "",
    voltage: product.voltage != null ? String(product.voltage) : "",
    wattsPerMeter: product.wattsPerMeter != null ? String(product.wattsPerMeter) : "",
    ipRating: product.ipRating ?? "",
    widthMm: product.widthMm != null ? String(product.widthMm) : "",
    cutLengthMm: product.cutLengthMm != null ? String(product.cutLengthMm) : "",
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

function writeBody(
  form: FormState,
  extras: LedProduct | null,
  includeId: boolean,
): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  const body: Record<string, unknown> = {
    label: form.label.trim(),
    notes: form.notes.trim(),
    formFactor: form.formFactor,
    driverId: form.driverId,
  };
  if (includeId) body.id = form.id.trim();
  const length = readWhole(form.defaultLength, "Suggested node count");
  if (!length.ok) return length;
  if (length.value != null) body.defaultLength = length.value;
  const gpio = readWhole(form.defaultGpio, "Suggested GPIO");
  if (!gpio.ok) return gpio;
  if (gpio.value != null) body.defaultGpio = gpio.value;
  const pitch = readMeasure(form.pitchMm, "Pitch", LED_SPACING_MM_MAX);
  if (!pitch.ok) return pitch;
  if (pitch.value != null) body.pitchMm = pitch.value;
  if (form.formFactor !== "cob") {
    const density = readMeasure(form.ledsPerMeter, "LEDs per metre", LED_DENSITY_PER_METER_MAX);
    if (!density.ok) return density;
    if (density.value != null) {
      if (density.value < 1) return { ok: false, message: "LEDs per metre must be at least 1." };
      body.ledsPerMeter = density.value;
    }
  }
  const section = readMeasure(form.sectionLengthMm, "Section length", LED_SPACING_MM_MAX);
  if (!section.ok) return section;
  if (section.value != null) body.sectionLengthMm = section.value;
  if (form.voltage) body.voltage = Number(form.voltage);
  const watts = readMeasure(form.wattsPerMeter, "Watts per metre", LED_WATTS_PER_METER_MAX);
  if (!watts.ok) return watts;
  if (watts.value != null) body.wattsPerMeter = watts.value;
  if (form.ipRating) body.ipRating = form.ipRating;
  const width = readMeasure(form.widthMm, "Strip width", LED_WIDTH_MM_MAX);
  if (!width.ok) return width;
  if (width.value != null) body.widthMm = width.value;
  const cut = readMeasure(form.cutLengthMm, "Cut length", LED_SPACING_MM_MAX);
  if (!cut.ok) return cut;
  if (cut.value != null) body.cutLengthMm = cut.value;
  if (form.densityNotes.trim()) body.densityNotes = form.densityNotes.trim();
  if (extras?.channels) body.channels = extras.channels;
  if (extras?.colorOrder) body.colorOrder = extras.colorOrder;
  if (extras?.bead) body.bead = extras.bead;
  return { ok: true, body };
}

function readWhole(
  raw: string,
  label: string,
): { ok: true; value?: number } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true };
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(value) || String(value) !== trimmed) {
    return { ok: false, message: `${label} must be a whole number.` };
  }
  return { ok: true, value };
}

function readMeasure(
  raw: string,
  label: string,
  max: number,
): { ok: true; value?: number } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0 || value > max) {
    return { ok: false, message: `${label} must be above 0 and at most ${max}.` };
  }
  return { ok: true, value };
}

function productSpacingLine(product: LedProduct): string | null {
  const spacing = ledProductSpacing(product);
  if (!spacing) return null;
  const kind = spacing.kind === "section" ? "section" : "pitch";
  const fromNodes =
    product.defaultLength != null
      ? formatNodeLength(product.defaultLength, spacing.mm)
      : null;
  const geometry = product.ledsPerMeter != null && product.formFactor !== "cob"
    ? `${product.ledsPerMeter} LEDs/m · ${Number(spacing.mm.toFixed(4))} mm ${kind}`
    : `${spacing.mm} mm ${kind}`;
  return fromNodes
    ? `${geometry} · about ${fromNodes} from ${product.defaultLength} nodes`
    : geometry;
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

  function setDensity(value: string) {
    const density = Number(value);
    setForm((current) => current ? { ...current, ledsPerMeter: value,
      pitchMm: value.trim() && Number.isFinite(density) && density > 0 ? String(1000 / density) : "" } : current);
    setNotice(null);
  }

  function setPitch(value: string) {
    setForm((current) => current ? { ...current, pitchMm: value, ledsPerMeter: "" } : current);
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
    const written = writeBody(form, extras, !editingId);
    if (!written.ok) {
      setNotice(written.message);
      return;
    }
    setBusy("save");
    setNotice(null);
    const res = editingId
      ? await patchJson<{ product?: LedProduct }>("/api/led-products/" + editingId, {
          product: written.body,
        })
      : await postJson<{ product?: LedProduct }>("/api/led-products", {
          product: written.body,
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

  function recipeRemoved(id: string) {
    setProducts((current) => current.filter((row) => row.id !== id));
    if (editingId === id) {
      setForm(null);
      setEditingId(null);
    }
    setNotice(null);
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
          suggestions — they fill Strip; this Light’s fields still override. Create and edit
          write the shared recipe only — not this Light’s length, GPIO, or ranges, not Apply,
          not a WLED write. Form factor is metadata — not written to WLED. A catalog row is not
          Hardware Done. {LED_CATALOG_DELETE_COPY}
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
          {form.formFactor !== "cob" ? (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-2">
                <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">LEDs per metre</span>
                <Input inputMode="decimal" value={form.ledsPerMeter}
                  onChange={(event) => setDensity(event.target.value)} aria-label="LEDs per metre" />
              </label>
              <div className="flex flex-wrap gap-2" aria-label="Common LED densities">
                {LED_DENSITIES_PER_METER.map((density) => (
                  <button key={density} type="button" aria-pressed={form.ledsPerMeter === String(density)}
                    className="rounded-md border border-input px-2.5 py-1 text-[12px] hover:bg-secondary"
                    onClick={() => setDensity(String(density))}>{density} LEDs/m</button>
                ))}
              </div>
              <span className="text-[12px] text-quiet">Pick a common density or enter the recipe’s addressable nodes per metre. This fills pitch for calculated length; it does not set this Light’s node count.</span>
            </div>
          ) : null}
          <label className="flex flex-col gap-2">
            <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
              {form.formFactor === "cob" ? "Section length" : "Pitch"}
            </span>
            <Input
              inputMode="decimal"
              value={form.formFactor === "cob" ? form.sectionLengthMm : form.pitchMm}
              onChange={(event) => form.formFactor === "cob"
                ? patchForm("sectionLengthMm", event.target.value)
                : setPitch(event.target.value)}
              aria-label={form.formFactor === "cob" ? "Section length" : "Pitch"}
            />
            <span className="text-[12px] text-quiet">
              {form.formFactor === "cob"
                ? "Millimetres of one addressable section. COB has no separate nodes."
                : "Millimetres between nodes, centre to centre. Editing pitch clears LEDs per metre."}{" "}
              {PHYSICAL_LENGTH_CAPTION} Not written to WLED.
            </span>
          </label>
          <details className="rounded-md border border-border px-3 py-2">
            <summary className="cursor-pointer font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
              Advanced
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-2">
                  <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
                    Voltage
                  </span>
                  <select
                    value={form.voltage}
                    onChange={(event) => patchForm("voltage", event.target.value)}
                    aria-label="Voltage"
                    className="h-10 rounded-md border border-input bg-[#07080a] px-2.5 text-[13px] text-foreground"
                  >
                    <option value="">Not set</option>
                    {LED_VOLTAGES.map((voltage) => (
                      <option key={voltage} value={String(voltage)}>
                        {voltage} V
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-2">
                  <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
                    Watts per metre
                  </span>
                  <Input
                    inputMode="decimal"
                    value={form.wattsPerMeter}
                    onChange={(event) => patchForm("wattsPerMeter", event.target.value)}
                    aria-label="Watts per metre"
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
                    IP rating
                  </span>
                  <select
                    value={form.ipRating}
                    onChange={(event) => patchForm("ipRating", event.target.value)}
                    aria-label="IP rating"
                    className="h-10 rounded-md border border-input bg-[#07080a] px-2.5 text-[13px] text-foreground"
                  >
                    <option value="">Not set</option>
                    {LED_IP_RATINGS.map((rating) => (
                      <option key={rating} value={rating}>
                        {rating}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-2">
                  <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
                    Strip width
                  </span>
                  <Input
                    inputMode="decimal"
                    value={form.widthMm}
                    onChange={(event) => patchForm("widthMm", event.target.value)}
                    aria-label="Strip width"
                  />
                  <span className="text-[12px] text-quiet">Millimetres.</span>
                </label>
                <label className="flex flex-col gap-2">
                  <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
                    Cut length
                  </span>
                  <Input
                    inputMode="decimal"
                    value={form.cutLengthMm}
                    onChange={(event) => patchForm("cutLengthMm", event.target.value)}
                    aria-label="Cut length"
                  />
                  <span className="text-[12px] text-quiet">
                    Shortest cut, in millimetres. Not the addressable section.
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
              <p className="text-[12px] text-quiet">
                Advanced facts stay on the recipe. They are not written to WLED and they do not
                change the calculated length.
              </p>
            </div>
          </details>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={cancelForm} disabled={busy !== null}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy !== null}>
              {busy === "save" ? "Saving…" : editingId ? "Save recipe" : "Create recipe"}
            </Button>
            {busy === "save" ? <LedLoader label="Saving recipe" /> : null}
          </div>
          <p className="text-[12px] text-quiet">
            Save recipe writes the catalog only. It is not Apply, not a WLED write, not Hardware
            Done.
          </p>
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
                  className="flex flex-col gap-3 rounded-xl border border-border bg-card px-[18px] py-4"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-base font-medium">{product.label}</span>
                      <span className="font-mono text-[11px] text-quiet">{product.id}</span>
                      <span className="text-[13px] leading-5 text-[#c9c3b8]">
                        {driverLabel(product.driverId)} · {formFactorLabel(product.formFactor)}
                        {product.defaultLength != null
                          ? ` · suggested ${product.defaultLength} nodes`
                          : ""}
                        {product.defaultGpio != null ? ` · GPIO ${product.defaultGpio}` : ""}
                        {product.voltage != null ? ` · ${product.voltage} V` : ""}
                        {product.wattsPerMeter != null ? ` · ${product.wattsPerMeter} W/m` : ""}
                      </span>
                      {productSpacingLine(product) ? (
                        <span className="text-[13px] leading-5 text-[#c9c3b8]">
                          {productSpacingLine(product)}. {PHYSICAL_LENGTH_CAPTION}
                        </span>
                      ) : null}
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
                  </div>
                  <CatalogDelete
                    productId={product.id}
                    label={product.label}
                    onDeleted={recipeRemoved}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
