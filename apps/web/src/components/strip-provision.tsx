"use client";

import {
  defaultStripPreset,
  draftLedTypeFromSettings,
  LED_CATALOG_ATTACH_COPY,
  LED_CATALOG_PER_LIGHT_COPY,
  LED_CATALOG_PER_LIGHT_HEADING,
  LED_CATALOG_SHARED_COPY,
  LED_CATALOG_SHARED_HEADING,
  PROVISION_LED_TYPES,
  provisionDraftFromProduct,
  provisionLedTypeLabel,
  stripColorOrderCopy,
  type LedProduct,
  type LightDetail,
  type ProvisionRead,
  type ProvisionWriteResult,
  type WledStripProvisionDraft,
} from "@nightplot/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchJson, patchJson, postJson } from "@/lib/api";

type ProvisionPayload = LightDetail & {
  provision: ProvisionRead;
  provisionWrite?: ProvisionWriteResult;
  ledProducts?: LedProduct[];
  message?: string;
};

export function StripProvisionPanel({
  lightId,
  unreachable,
  onUpdated,
}: {
  lightId: string;
  unreachable: boolean;
  onUpdated?: (detail: LightDetail) => void;
}) {
  const [read, setRead] = useState<ProvisionRead | null>(null);
  const [draft, setDraft] = useState<WledStripProvisionDraft | null>(null);
  const [products, setProducts] = useState<LedProduct[]>([]);
  const [attachedId, setAttachedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "apply" | "attach" | null>("load");
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionWriteResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy("load");
    void fetchJson<ProvisionPayload>(`/api/lights/${lightId}/provision`)
      .then((payload) => {
        if (cancelled) return;
        setRead(payload.provision);
        const catalog = payload.ledProducts ?? [];
        setProducts(catalog);
        setAttachedId(payload.light.ledProductId ?? null);
        const fallback = defaultStripPreset();
        setDraft({
          ledType: draftLedTypeFromSettings(payload.provision.settings.ledType),
          length: payload.provision.settings.length ?? fallback.length,
          gpio: payload.provision.settings.gpio ?? fallback.gpio,
        });
        setNotice(payload.provision.refuse);
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

  function patch<K extends keyof WledStripProvisionDraft>(
    key: K,
    value: WledStripProvisionDraft[K],
  ) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
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
      setDraft(filled.draft);
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
    if (!draft || !read) return;
    setBusy("apply");
    setNotice(null);
    const res = await postJson<ProvisionPayload>(
      `/api/lights/${lightId}/provision`,
      { provision: draft },
    );
    setBusy(null);
    const payload = res.data as ProvisionPayload;
    if (payload.provision) {
      setRead(payload.provision);
      if (payload.provision.settings.length != null && payload.provision.settings.gpio != null) {
        setDraft({
          ledType: draftLedTypeFromSettings(payload.provision.settings.ledType),
          length: payload.provision.settings.length,
          gpio: payload.provision.settings.gpio,
        });
      }
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

  if (!read || !draft) {
    return (
      <p className="text-[13px] text-destructive">
        {notice ?? "Strip provision did not load."}
      </p>
    );
  }

  const failed = result && !result.matched;
  const afterSameTypeApply = Boolean(result?.matched && result.orderPreserved);
  const colorOrderCopy = stripColorOrderCopy({
    colorOrder: read.settings.colorOrder,
    ledType: read.settings.ledType,
    afterSameTypeApply,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-[20px] font-semibold">Strip</h2>
        <p className="text-[13px] leading-5 text-[#c9c3b8]">
          First-time bus on this Light: LED type, node count, and GPIO. A shared catalog recipe
          fills the form from that SKU and its driver; this Light’s fields still override. Apply
          writes /json/cfg, then reads the snapshot back. Colour order on the bus is named after
          Apply; Strip does not pick it. A length change clips or drops declared ranges that run
          past the new strip, and flags leftover coverage. Preview is not Apply.
        </p>
      </div>

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
        <div className="grid gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-[#0e1014] p-4">
            <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
              LED type
            </span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="LED type">
              {PROVISION_LED_TYPES.map((ledType) => {
                const selectedType = draft.ledType === ledType;
                return (
                  <button
                    key={ledType}
                    type="button"
                    aria-pressed={selectedType}
                    onClick={() => patch("ledType", ledType)}
                    className={`h-10 rounded-md border px-3 text-[13px] font-semibold ${
                      selectedType
                        ? "border-primary bg-secondary text-foreground"
                        : "border-input bg-[#07080a] text-[#c9c3b8] hover:bg-secondary"
                    }`}
                  >
                    {provisionLedTypeLabel(ledType)}
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
                patch("length", Number.parseInt(event.target.value, 10) || 0)
              }
              aria-label="Node count"
            />
            <span className="text-[12px] text-quiet">Node count on this Light.</span>
          </label>
          <label className="flex flex-col gap-2 rounded-xl border border-border bg-[#0e1014] p-4">
            <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
              GPIO
            </span>
            <Input
              inputMode="numeric"
              value={draft.gpio}
              onChange={(event) => patch("gpio", Number.parseInt(event.target.value, 10) || 0)}
              aria-label="GPIO pin"
            />
            <span className="text-[12px] text-quiet">Single data pin on this Light.</span>
          </label>
        </div>
        </div>
      )}

      {!read.refuse && !unreachable && !result?.matched ? (
        <div className="flex flex-col gap-1">
          <p className="text-[13px] leading-5 text-[#c9c3b8]">{colorOrderCopy}</p>
          <p className="text-[12px] text-quiet">Strip does not pick colour order.</p>
        </div>
      ) : null}

      {read.settings.ledType === "unknown" && !read.refuse ? (
        <p className="text-[13px] text-quiet">
          Live bus type is unknown. Apply writes the selected type’s mapping for this firmware.
        </p>
      ) : null}

      {failed ? (
        <div className="flex flex-col gap-2 rounded-[14px] border border-[#5a2f33] bg-[#1a1113] p-4">
          <span className="text-[16px] font-semibold text-destructive">{result.message}</span>
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
          <p className="text-[12px] text-primary">{result.caption}</p>
        </div>
      ) : null}

      {result?.matched ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-primary">{result.message}</p>
          <p className="text-[13px] text-primary">{colorOrderCopy}</p>
          <p className="text-[12px] text-quiet">Strip does not pick colour order.</p>
          {result.ranges?.notes.map((note) => (
            <p key={note} className="text-[13px] text-primary">
              {note}
            </p>
          ))}
        </div>
      ) : null}
      {notice && !failed ? <p className="text-[13px] text-destructive">{notice}</p> : null}
      {!failed ? <p className="text-[12px] text-primary">{read.caption}</p> : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          onClick={() => {
            const fallback = defaultStripPreset();
            setDraft({
              ledType: draftLedTypeFromSettings(read.settings.ledType),
              length: read.settings.length ?? fallback.length,
              gpio: read.settings.gpio ?? fallback.gpio,
            });
            setResult(null);
            setNotice(read.refuse);
          }}
          disabled={busy !== null}
        >
          Revert
        </Button>
        <Button onClick={() => void apply()} disabled={!writable || busy !== null}>
          {busy === "apply" ? "Applying…" : "Apply"}
        </Button>
      </div>
    </div>
  );
}
