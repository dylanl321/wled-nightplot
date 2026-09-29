"use client";

import {
  LED_CATALOG_DELETE_CAPTION,
  LED_CATALOG_DELETE_REFUSE_UNKNOWN,
  canDeleteCatalog,
  catalogDeleteProgress,
  catalogDeleteRefuseReason,
  type CatalogDeleteCheck,
} from "@nightplot/shared";
import { useEffect, useState } from "react";
import { GlowingLedLoader } from "@/components/glowing-led-loader";
import { Button } from "@/components/ui/button";
import { deleteJson, fetchJson } from "@/lib/api";
import { cn } from "@/lib/utils";

export function CatalogDelete({
  productId,
  label,
  initialChecks,
  onDeleted,
}: {
  productId: string;
  label: string;
  initialChecks?: CatalogDeleteCheck[] | null;
  onDeleted: (productId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [checks, setChecks] = useState<CatalogDeleteCheck[]>(initialChecks ?? []);
  const [caption, setCaption] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "delete" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open is the trigger
  }, [open, productId]);

  async function refresh() {
    setBusy("check");
    setNotice(null);
    try {
      const next = await fetchJson<{
        checks: CatalogDeleteCheck[];
        caption?: string;
      }>(`/api/led-products/${productId}/delete-checks`);
      setChecks(next.checks);
      setCaption(next.caption ?? LED_CATALOG_DELETE_CAPTION);
    } catch (caught) {
      setChecks([
        {
          key: "attaches",
          label: "Lights attach",
          status: "unknown",
          detail: LED_CATALOG_DELETE_REFUSE_UNKNOWN,
        },
      ]);
      setCaption(LED_CATALOG_DELETE_CAPTION);
      setNotice(caught instanceof Error ? caught.message : LED_CATALOG_DELETE_REFUSE_UNKNOWN);
    }
    setBusy(null);
  }

  async function remove() {
    if (!canDeleteCatalog(checks)) {
      setNotice(catalogDeleteRefuseReason(checks));
      return;
    }
    setBusy("delete");
    setNotice(null);
    const res = await deleteJson<{ message?: string }>(`/api/led-products/${productId}`);
    setBusy(null);
    if (!res.ok) {
      const payload = res.data as { message?: string; checks?: CatalogDeleteCheck[] };
      if (payload.checks) setChecks(payload.checks);
      setNotice(payload.message ?? catalogDeleteRefuseReason(checks));
      return;
    }
    onDeleted(productId);
    setOpen(false);
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={busy !== null}
      >
        Remove recipe
      </Button>
    );
  }

  const progress = catalogDeleteProgress(checks);
  const unlocked = canDeleteCatalog(checks);
  const reason = catalogDeleteRefuseReason(checks);

  return (
    <div className="flex w-full flex-col gap-3 rounded-[14px] border border-[#3a4150] bg-[#12141a] p-4">
      <div className="flex flex-col gap-1">
        <span className="text-[16px] font-semibold">Remove {label} from the catalog?</span>
        <span className="text-[13px] text-muted-foreground">
          {unlocked
            ? "No Lights attach this recipe."
            : "Checking Lights that still attach this recipe."}
        </span>
      </div>
      <div className="flex flex-col">
        {checks.map((check) => (
          <div
            key={check.key}
            className="grid grid-cols-[22px_minmax(7rem,9.5rem)_minmax(0,1fr)] items-start gap-3 border-b border-border py-2.5 last:border-b-0 sm:grid-cols-[22px_150px_minmax(0,1fr)_auto]"
          >
            <span
              className={cn(
                "font-medium",
                check.status === "ok" && "text-online",
                check.status === "unknown" && "text-primary",
                check.status === "blocked" && "text-destructive",
              )}
            >
              {check.status === "ok" ? "✓" : check.status === "unknown" ? "?" : "✕"}
            </span>
            <span className="text-muted-foreground">{check.label}</span>
            <span
              className={cn(
                "text-[13px] leading-5",
                check.status === "unknown" ? "text-[#c9c3b8]" : "text-foreground",
              )}
            >
              {check.detail}
            </span>
            {check.status === "unknown" ? (
              <button
                type="button"
                onClick={() => void refresh()}
                className="text-left text-[13px] text-foreground sm:text-right"
                disabled={busy !== null}
              >
                {busy === "check" ? "Checking…" : "Check again"}
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {unlocked ? (
        <p className="text-[12px] leading-5 text-quiet">
          Nightplot forgets this shared recipe. Lights and the controller stay as they are.
        </p>
      ) : (
        <p className="text-[13px] text-primary">
          {reason ?? "Unlocks when no Light attaches this recipe."}
        </p>
      )}
      {caption ? <p className="text-[12px] text-primary">{caption}</p> : null}
      {notice ? <p className="text-[13px] text-destructive">{notice}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {unlocked ? (
          <Button
            type="button"
            className="h-[52px] bg-destructive text-primary-foreground hover:bg-[#c45c5c] sm:h-10 sm:min-w-[220px]"
            disabled={busy !== null}
            onClick={() => void remove()}
          >
            {busy === "delete" ? "Removing…" : "Remove recipe"}
          </Button>
        ) : (
          <div className="relative h-10 w-full overflow-hidden rounded-lg border border-[#3a4150] bg-[#1a1d24] sm:w-[220px]">
            <div
              className="absolute inset-y-0 left-0 bg-[#5a2f33]"
              style={{
                width: progress.total
                  ? `${Math.round((progress.done / progress.total) * 100)}%`
                  : "0%",
              }}
            />
            <span className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-muted-foreground">
              Remove · {progress.done} of {progress.total} checks
            </span>
          </div>
        )}
        {busy === "delete" ? <GlowingLedLoader label="Removing recipe" /> : null}
        {!unlocked ? (
          <span className="text-[13px] text-primary sm:ml-1">
            Unlocks when no Light attaches this recipe.
          </span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="h-12 sm:ml-auto sm:h-10"
          onClick={() => {
            setOpen(false);
            setNotice(null);
          }}
        >
          Keep recipe
        </Button>
      </div>
    </div>
  );
}
