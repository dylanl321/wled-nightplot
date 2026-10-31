"use client";

import {
  defaultStripPreset,
  draftLedTypeFromSettings,
  nativeTypeLabel,
  formatNodeLength,
  ledProductSpacing,
  LED_CATALOG_ATTACH_COPY,
  LED_CATALOG_PER_LIGHT_COPY,
  LED_CATALOG_PER_LIGHT_HEADING,
  LED_CATALOG_SHARED_COPY,
  LED_CATALOG_SHARED_HEADING,
  PROVISION_LED_TYPES,
  provisionDraftFromProduct,
  provisionLedTypeLabel,
  PHYSICAL_LENGTH_CAPTION,
  stripColorOrderCopy,
  type LedProduct,
  type LightDetail,
  type ProvisionBusRead,
  type ProvisionRead,
  type ProvisionWriteResult,
  type WledStripProvisionDraft,
  type WledStripProvisionOutputDraft,
} from "@nightplot/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LedLoader } from "@/components/ui/led-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchJson, patchJson, postJson } from "@/lib/api";

type ProvisionPayload = LightDetail & {
  provision: ProvisionRead;
  provisionWrite?: ProvisionWriteResult;
  ledProducts?: LedProduct[];
  nightplotSuggestions?: { ledCount: number | null; gpio: number | null; defaultLedProductId: string | null };
  message?: string;
};

export function draftsFromProvision(
  provision: ProvisionRead,
  suggestions?: { ledCount: number | null; gpio: number | null } | null,
  suggestedProduct?: LedProduct | null,
): WledStripProvisionOutputDraft[] {
  const fallback = defaultStripPreset();
  const productDraft =
    suggestedProduct != null ? provisionDraftFromProduct(suggestedProduct) : null;
  const product = productDraft?.ok === true ? productDraft.draft : null;
  const writable = provision.outputs.filter((bus) => bus.writable);
  const sources: ProvisionBusRead[] =
    writable.length > 0
      ? writable
      : [
          {
            index: 0,
            start: 0,
            settings: provision.settings,
            refuse: provision.refuse,
            writable: false,
          },
        ];
  return sources.map((bus, offset) => {
    const first = offset === 0;
    // `settings` is the first understood writable bus; the test/load path
    // may update that row without rewriting `outputs[0]`.
    const settings = first ? provision.settings : bus.settings;
    return {
      index: bus.index,
      ledType: draftLedTypeFromSettings(settings.ledType),
      length:
        settings.length ??
        (first ? suggestions?.ledCount : null) ??
        (first ? product?.length : null) ??
        fallback.length,
      gpio:
        settings.gpio ??
        (first ? suggestions?.gpio : null) ??
        (first ? product?.gpio : null) ??
        fallback.gpio,
    };
  });
}

export function StripProvisionPanel({
  lightId,
  unreachable,
  embedded = false,
  onUpdated,
}: {
  lightId: string;
  unreachable: boolean;
  embedded?: boolean;
  onUpdated?: (detail: LightDetail) => void;
}) {
  const [read, setRead] = useState<ProvisionRead | null>(null);
  const [drafts, setDrafts] = useState<WledStripProvisionOutputDraft[] | null>(null);
  const [products, setProducts] = useState<LedProduct[]>([]);
  const [attachedId, setAttachedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "apply" | "attach" | null>("load");
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionWriteResult | null>(null);
  const [loadedFor, setLoadedFor] = useState(lightId);

  if (loadedFor !== lightId) {
    setLoadedFor(lightId);
    setBusy("load");
  }

  useEffect(() => {
    let cancelled = false;
    void fetchJson<ProvisionPayload>(`/api/lights/${lightId}/provision`)
      .then((payload) => {
        if (cancelled) return;
        setRead(payload.provision);
        const catalog = payload.ledProducts ?? [];
        setProducts(catalog);
        setAttachedId(payload.light.ledProductId ?? null);
        const suggestions = payload.nightplotSuggestions;
        const suggestedProduct = !payload.light.ledProductId
          ? catalog.find((product) => product.id === suggestions?.defaultLedProductId)
          : null;
        setDrafts(draftsFromProvision(payload.provision, suggestions, suggestedProduct));
        setNotice(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setNotice(caught instanceof Error ? caught.message : "Strip provision did not load.");
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [lightId]);

  const writable = Boolean(read?.fingerprint.writable) && !unreachable;
  const selected = products.find((product) => product.id === attachedId);
  const draft = drafts?.[0] ?? null;

  function patch(
    index: number,
    key: keyof WledStripProvisionDraft,
    value: WledStripProvisionDraft[keyof WledStripProvisionDraft],
  ) {
    setDrafts((current) =>
      current?.map((row) => (row.index === index ? { ...row, [key]: value } : row)) ?? current,
    );
    setResult(null);
    setNotice(null);
  }

  async function attachProduct(product: LedProduct | null) {
    setResult(null);
    setNotice(null);
    if (product) {
      const filled = provisionDraftFromProduct(product, draft ?? undefined);
      if (!filled.ok) {
        setNotice(filled.message);
        return;
      }
      setDrafts((current) =>
        (current ?? [{ index: 0, ...filled.draft }]).map((row) => ({ ...row, ...filled.draft })),
      );
    }
    setBusy("attach");
    const res = await patchJson<ProvisionPayload>(`/api/lights/${lightId}/led-product`, {
      ledProductId: product?.id ?? null,
    });
    setBusy(null);
    const payload = res.data as ProvisionPayload;
    if (payload.light) {
      setAttachedId(payload.light.ledProductId ?? null);
      if (payload.ledProducts) setProducts(payload.ledProducts);
      onUpdated?.(payload);
    }
    if (!res.ok) {
      setNotice(payload.message ?? "LED product was not attached.");
      return;
    }
  }

  async function apply() {
    if (!drafts?.length || !read) return;
    setBusy("apply");
    setNotice(null);
    const res = await postJson<ProvisionPayload>(
      `/api/lights/${lightId}/provision`,
      drafts.length === 1
        ? { provision: { ledType: drafts[0]!.ledType, length: drafts[0]!.length, gpio: drafts[0]!.gpio } }
        : { provision: { outputs: drafts } },
    );
    setBusy(null);
    const payload = res.data as ProvisionPayload;
    if (payload.provision) {
      setRead(payload.provision);
      setDrafts(draftsFromProvision(payload.provision));
    }
    if (payload.light) {
      setAttachedId(payload.light.ledProductId ?? null);
      onUpdated?.(payload);
    }
    if (payload.provisionWrite) setResult(payload.provisionWrite);
    if (res.ok) {
      window.dispatchEvent(new Event("nightplot:lights-changed"));
    }
    if (!res.ok) {
      setNotice(
        payload.message ?? payload.provisionWrite?.message ?? "Strip provision was not written.",
      );
    }
  }

  if (busy === "load" && !read) {
    return <p className="text-[13px] text-quiet">Reading /json/cfg bus…</p>;
  }

  if (!read || !draft || !drafts) {
    return (
      <p className="text-[13px] text-destructive">
        {notice ?? "Strip provision did not load."}
      </p>
    );
  }

  const failed = result && !result.matched;
  const afterSameTypeApply = Boolean(result?.matched && result.orderPreserved);
  const fallback = defaultStripPreset();
  const formDirty = drafts.some((row, offset) => {
    const bus = read.outputs.find((item) => item.index === row.index);
    const settings = offset === 0 ? read.settings : (bus?.settings ?? read.settings);
    return (
      row.ledType !== draftLedTypeFromSettings(settings.ledType) ||
      row.length !== (settings.length ?? fallback.length) ||
      row.gpio !== (settings.gpio ?? fallback.gpio)
    );
  });
  const many = drafts.length > 1;
  const outputRows = result?.outputs ?? [];

  return (
    <div className="flex flex-col gap-4">
      {embedded ? null : (
      <div className="flex flex-col gap-1">
        <h2 className="text-[20px] font-semibold">Strip</h2>
        <p className="text-[13px] leading-5 text-[#c9c3b8]">
          First-time bus on this Light: LED type, node count, and GPIO for every understood
          output. A shared catalog recipe fills the form from that SKU and its driver; this
          Light’s fields still override. Apply writes /json/cfg, then reads each written bus
          back. Colour order on a bus is named after Apply; Strip does not pick it. A length
          change clips or drops declared ranges that run past the new strip, and flags leftover
          coverage. Preview is not Apply.
        </p>
      </div>
      )}

      <fieldset className="flex flex-col gap-2 rounded-xl border border-border bg-[#0e1014] p-4">
        <legend className="px-1 font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
          {LED_CATALOG_SHARED_HEADING}
        </legend>
        <p className="text-[12px] text-quiet">{LED_CATALOG_SHARED_COPY}</p>
        <p className="text-[12px] text-quiet">{LED_CATALOG_ATTACH_COPY}</p>
        <p className="text-[12px] text-quiet">
          Form factor is metadata. A product may name WS281x or SK6812 RGBW.{" "}
          <Link href="/led-products" className="text-primary">
            Manage LED products
          </Link>
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={attachedId === null}
            onClick={() => void attachProduct(null)}
            disabled={busy !== null}
            className={`rounded-lg border px-3 py-2 text-left text-[13px] font-semibold ${
              attachedId === null
                ? "border-primary bg-secondary text-foreground"
                : "border-input bg-[#07080a] text-[#c9c3b8] hover:bg-secondary"
            }`}
          >
            Manual fields
          </button>
          {products.map((product) => {
            const selectedProduct = attachedId === product.id;
            return (
              <button
                key={product.id}
                type="button"
                aria-pressed={selectedProduct}
                onClick={() => void attachProduct(product)}
                disabled={busy !== null}
                className={`rounded-lg border px-3 py-2 text-left text-[13px] font-semibold ${
                  selectedProduct
                    ? "border-primary bg-secondary text-foreground"
                    : "border-input bg-[#07080a] text-[#c9c3b8] hover:bg-secondary"
                }`}
              >
                {product.label}
              </button>
            );
          })}
        </div>
        <p className="text-[12px] text-quiet">
          {selected
            ? `${selected.notes || selected.label} Attached recipe fills these fields. Change them for this Light — the shared catalog row stays as it is.`
            : products.length === 0
              ? "No LED products in the catalog. Fields stay manual on this Light."
              : "This Light’s fields override the catalog. Manual fields keeps no product attached."}
        </p>
      </fieldset>

      {read.buses > 1 ? (
        <div className="rounded-xl border border-border bg-[#0e1014] p-4">
          <p className="text-[13px] leading-5 text-[#c9c3b8]">
            This controller has {read.buses} outputs. Apply writes every understood output —
            each with its own LED type, length, and GPIO — then reads those buses back. Analog
            or multi-pin buses stay listed and are not written.
          </p>
          <ul className="mt-2 space-y-1 font-mono text-[12px] text-quiet">
            {read.outputs.map((bus) => (
              <li key={bus.index}>
                Output {bus.index + 1}
                {bus.settings.length != null ? ` · ${bus.settings.length} LEDs` : ""}
                {bus.settings.gpio != null ? ` · GPIO ${bus.settings.gpio}` : ""}
                {bus.settings.ledType !== "unknown" ? ` · ${provisionLedTypeLabel(bus.settings.ledType)}` : ""}
                {bus.refuse ? ` · ${bus.refuse}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {read.refuse || unreachable ? (
        <div className="rounded-[14px] border border-[#5a2f33] bg-[#1a1113] p-4">
          <p className="text-[15px] font-semibold text-destructive">
            {unreachable
              ? "This Light hasn’t answered. Refresh or re-address it first."
              : read.refuse}
          </p>
          <p className="mt-2 text-[12px] text-primary">{read.caption}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <h3 className="text-[15px] font-semibold">{LED_CATALOG_PER_LIGHT_HEADING}</h3>
            <p className="text-[12px] text-quiet">{LED_CATALOG_PER_LIGHT_COPY}</p>
          </div>
          {many ? (
            <div className="flex flex-col gap-3">
              {drafts.map((row) => {
                const bus = read.outputs.find((item) => item.index === row.index);
                return (
                  <OutputDraftFields
                    key={row.index}
                    draft={row}
                    many
                    selected={selected}
                    colorOrder={bus?.settings.colorOrder ?? null}
                    ledType={bus?.settings.ledType ?? row.ledType}
                    afterSameTypeApply={afterSameTypeApply}
                    onPatch={(key, value) => patch(row.index, key, value)}
                  />
                );
              })}
            </div>
          ) : (
            <OutputDraftFields
              draft={draft}
              many={false}
              selected={selected}
              colorOrder={read.settings.colorOrder}
              ledType={read.settings.ledType}
              afterSameTypeApply={afterSameTypeApply}
              onPatch={(key, value) => patch(draft.index, key, value)}
            />
          )}
        </div>
      )}

      {!read.refuse && !unreachable && !result?.matched && !many ? (
        <div className="flex flex-col gap-1">
          <p className="text-[13px] leading-5 text-[#c9c3b8]">
            {stripColorOrderCopy({
              colorOrder: read.settings.colorOrder,
              ledType: read.settings.ledType,
              afterSameTypeApply,
            })}
          </p>
          <p className="text-[12px] text-quiet">Strip does not pick colour order.</p>
        </div>
      ) : null}

      {read.settings.ledType === "unknown" && !read.refuse ? (
        <p className="text-[13px] text-quiet">
          {read.settings.nativeType !== null
            ? `This bus reports ${nativeTypeLabel(read.settings.nativeType)}, which Strip does not map.`
            : "Live bus type is unknown."}{" "}
          Apply writes the selected type’s mapping for this firmware.
        </p>
      ) : null}

      {failed ? (
        <div className="flex flex-col gap-2 rounded-[14px] border border-[#5a2f33] bg-[#1a1113] p-4">
          <span className="text-[16px] font-semibold text-destructive">{result.message}</span>
          {outputRows.length > 1 ? (
            <div className="flex flex-col gap-2 text-[13px]">
              {outputRows.map((row) => (
                <div key={row.index} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                  <span className="text-muted-foreground">Output {row.index + 1} sent</span>
                  <span className="font-mono">
                    {row.sent.ledType} · {row.sent.length} nodes · GPIO {row.sent.gpio}
                  </span>
                  <span className="text-muted-foreground">Output {row.index + 1} read back</span>
                  <span className={`font-mono ${row.matched ? "" : "text-destructive"}`}>
                    {row.read.ledType} · {row.read.length ?? "—"} nodes · GPIO {row.read.gpio ?? "—"}
                    {row.matched ? "" : " · mismatch"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
              <span className="text-muted-foreground">Sent</span>
              <span className="font-mono">
                {result.sent.ledType} · {result.sent.length} nodes · GPIO {result.sent.gpio}
              </span>
              <span className="text-muted-foreground">Read back</span>
              <span className="font-mono text-destructive">
                {result.read.ledType} · {result.read.length ?? "—"} nodes · GPIO{" "}
                {result.read.gpio ?? "—"}
                {result.snapshotLedCount != null
                  ? ` · snapshot ${result.snapshotLedCount} LEDs`
                  : ""}
              </span>
            </div>
          )}
          <p className="text-[12px] text-primary">{result.caption}</p>
        </div>
      ) : null}

      {result?.matched ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-primary">{result.message}</p>
          {!many ? (
            <>
              <p className="text-[13px] text-primary">
                {stripColorOrderCopy({
                  colorOrder: read.settings.colorOrder,
                  ledType: read.settings.ledType,
                  afterSameTypeApply,
                })}
              </p>
              <p className="text-[12px] text-quiet">Strip does not pick colour order.</p>
            </>
          ) : null}
          {outputRows.length > 1
            ? outputRows.map((row) => (
                <p key={row.index} className="font-mono text-[12px] text-primary">
                  Output {row.index + 1} · {row.sent.ledType} · {row.sent.length} nodes · GPIO{" "}
                  {row.sent.gpio} · matched
                </p>
              ))
            : null}
          {result.ranges?.notes.map((note) => (
            <p key={note} className="text-[13px] text-primary">
              {note}
            </p>
          ))}
        </div>
      ) : null}
      {notice && !failed ? <p className="text-[13px] text-destructive">{notice}</p> : null}
      {!failed && !read.refuse && !unreachable ? (
        <p className="text-[12px] text-primary">{read.caption}</p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          onClick={() => {
            setDrafts(draftsFromProvision(read));
            setResult(null);
            setNotice(null);
          }}
          disabled={busy !== null}
        >
          Revert
        </Button>
        <Button
          variant={formDirty ? "default" : "outline"}
          onClick={() => void apply()}
          disabled={!writable || busy !== null}
        >
          {busy === "apply" ? "Applying…" : "Apply hardware"}
        </Button>
        {busy === "apply" ? <LedLoader label="Applying strip hardware" /> : null}
      </div>
    </div>
  );
}

function OutputDraftFields({
  draft,
  many,
  selected,
  colorOrder,
  ledType,
  afterSameTypeApply,
  onPatch,
}: {
  draft: WledStripProvisionOutputDraft;
  many: boolean;
  selected: LedProduct | undefined;
  colorOrder: string | null;
  ledType: Parameters<typeof stripColorOrderCopy>[0]["ledType"];
  afterSameTypeApply: boolean;
  onPatch: (
    key: keyof WledStripProvisionDraft,
    value: WledStripProvisionDraft[keyof WledStripProvisionDraft],
  ) => void;
}) {
  const lengthLabel = formatNodeLength(
    draft.length,
    selected ? ledProductSpacing(selected)?.mm : null,
  );
  const n = draft.index + 1;
  const ledTypeLabel = many ? `Output ${n} LED type` : "LED type";
  const lengthAria = many ? `Output ${n} node count` : "Node count";
  const gpioAria = many ? `Output ${n} GPIO pin` : "GPIO pin";
  return (
    <fieldset className={many ? "flex flex-col gap-3 rounded-xl border border-border bg-[#0e1014] p-4" : undefined}>
      {many ? (
        <legend className="px-1 font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
          Output {n}
        </legend>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-[#0e1014] p-4">
          <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
            LED type
          </span>
          <div className="flex flex-wrap gap-2" role="group" aria-label={ledTypeLabel}>
            {PROVISION_LED_TYPES.map((type) => {
              const selectedType = draft.ledType === type;
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={selectedType}
                  onClick={() => onPatch("ledType", type)}
                  className={`h-10 rounded-md border px-3 text-[13px] font-semibold ${
                    selectedType
                      ? "border-primary bg-secondary text-foreground"
                      : "border-input bg-[#07080a] text-[#c9c3b8] hover:bg-secondary"
                  }`}
                >
                  {provisionLedTypeLabel(type)}
                </button>
              );
            })}
          </div>
          <span className="text-[12px] text-quiet">
            Mapped types only. Unknown bus types are not written.
          </span>
        </div>
        <label className="flex flex-col gap-2 rounded-xl border border-border bg-[#0e1014] p-4">
          <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
            Length
          </span>
          <Input
            inputMode="numeric"
            value={draft.length}
            onChange={(event) =>
              onPatch("length", Number.parseInt(event.target.value, 10) || 0)
            }
            aria-label={lengthAria}
          />
          <span className="text-[12px] text-quiet">
            {many ? `Node count on output ${n}.` : "Node count on this Light."}
          </span>
          {lengthLabel ? (
            <span className="text-[12px] text-quiet">
              {lengthLabel}. {PHYSICAL_LENGTH_CAPTION}
            </span>
          ) : null}
        </label>
        <label className="flex flex-col gap-2 rounded-xl border border-border bg-[#0e1014] p-4">
          <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
            GPIO
          </span>
          <Input
            inputMode="numeric"
            value={draft.gpio}
            onChange={(event) => onPatch("gpio", Number.parseInt(event.target.value, 10) || 0)}
            aria-label={gpioAria}
          />
          <span className="text-[12px] text-quiet">
            {many ? `Data pin on output ${n}.` : "Single data pin on this Light."}
          </span>
        </label>
      </div>
      {many ? (
        <div className="flex flex-col gap-1">
          <p className="text-[13px] leading-5 text-[#c9c3b8]">
            {stripColorOrderCopy({ colorOrder, ledType, afterSameTypeApply })}
          </p>
          <p className="text-[12px] text-quiet">Strip does not pick colour order.</p>
        </div>
      ) : null}
    </fieldset>
  );
}
