"use client";

import {
  type LightDetail,
  type ProvisionRead,
  type ProvisionWriteResult,
  type WledStripProvisionDraft,
} from "@nightplot/shared";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchJson, postJson } from "@/lib/api";

type ProvisionPayload = LightDetail & {
  provision: ProvisionRead;
  provisionWrite?: ProvisionWriteResult;
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
  const [busy, setBusy] = useState<"load" | "apply" | null>("load");
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionWriteResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy("load");
    void fetchJson<ProvisionPayload>(`/api/lights/${lightId}/provision`)
      .then((payload) => {
        if (cancelled) return;
        setRead(payload.provision);
        setDraft({
          ledType: "ws281x",
          length: payload.provision.settings.length ?? 60,
          gpio: payload.provision.settings.gpio ?? 16,
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

  function patch<K extends keyof WledStripProvisionDraft>(
    key: K,
    value: WledStripProvisionDraft[K],
  ) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setResult(null);
    setNotice(null);
  }

  async function apply() {
    if (!draft || !read) return;
    setBusy("apply");
    setNotice(null);
    const res = await postJson<ProvisionPayload>(`/api/lights/${lightId}/provision`, {
      provision: draft,
    });
    setBusy(null);
    const payload = res.data as ProvisionPayload;
    if (payload.provision) {
      setRead(payload.provision);
      if (payload.provision.settings.length != null && payload.provision.settings.gpio != null) {
        setDraft({
          ledType: "ws281x",
          length: payload.provision.settings.length,
          gpio: payload.provision.settings.gpio,
        });
      }
    }
    if (payload.provisionWrite) setResult(payload.provisionWrite);
    if (payload.light) onUpdated?.(payload);
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-[20px] font-semibold">Strip</h2>
        <p className="text-[13px] leading-5 text-[#c9c3b8]">
          First-time bus: LED type, node count, and GPIO. Apply writes /json/cfg, then reads the
          snapshot back. Preview is not Apply.
        </p>
      </div>

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
        <div className="grid gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-2 rounded-xl border border-border bg-[#0e1014] p-4">
            <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
              LED type
            </span>
            <div className="flex h-10 items-center rounded-md border border-primary bg-secondary px-3 text-[13px] font-semibold">
              WS281x
            </div>
            <span className="text-[12px] text-quiet">
              First strip member. Other bus types are not written.
            </span>
          </label>
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
            <span className="text-[12px] text-quiet">Node count on this bus.</span>
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
            <span className="text-[12px] text-quiet">Single data pin for WS281x.</span>
          </label>
        </div>
      )}

      {read.settings.ledType === "unknown" && !read.refuse ? (
        <p className="text-[13px] text-quiet">
          Live bus type is unknown. Apply writes the WS281x mapping for this firmware.
        </p>
      ) : null}

      {failed ? (
        <div className="flex flex-col gap-2 rounded-[14px] border border-[#5a2f33] bg-[#1a1113] p-4">
          <span className="text-[16px] font-semibold text-destructive">Apply didn’t stick</span>
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
          <p className="text-[13px] text-destructive">{result.message}</p>
          <p className="text-[12px] text-primary">{result.caption}</p>
        </div>
      ) : null}

      {result?.matched ? (
        <p className="text-[13px] text-primary">{result.message}</p>
      ) : null}
      {notice && !failed ? <p className="text-[13px] text-destructive">{notice}</p> : null}
      {!failed ? <p className="text-[12px] text-primary">{read.caption}</p> : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          onClick={() => {
            setDraft({
              ledType: "ws281x",
              length: read.settings.length ?? 60,
              gpio: read.settings.gpio ?? 16,
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
