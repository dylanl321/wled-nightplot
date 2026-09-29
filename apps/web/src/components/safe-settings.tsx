"use client";

import {
  fieldLabel,
  requestedFields,
  transitionMs,
  transitionUnitsFromMs,
  type LightDetail,
  type SafeFieldKey,
  type SafeRead,
  type SafeWriteResult,
  type WledSafeSettings,
} from "@nightplot/shared";
import { useEffect, useState, type ReactNode } from "react";
import { GlowingLedLoader } from "@/components/glowing-led-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchJson, postJson } from "@/lib/api";
import { cn } from "@/lib/utils";

type SafePayload = LightDetail & {
  safe: SafeRead;
  safeWrite?: SafeWriteResult;
  message?: string;
};

export function SafeSettingsPanel({
  lightId,
  unreachable,
  embedded = false,
  staleInfoName,
  onUpdated,
}: {
  lightId: string;
  unreachable: boolean;
  embedded?: boolean;
  staleInfoName?: string | null;
  onUpdated?: (detail: LightDetail) => void;
}) {
  const [read, setRead] = useState<SafeRead | null>(null);
  const [draft, setDraft] = useState<WledSafeSettings | null>(null);
  const [busy, setBusy] = useState<"load" | "write" | null>("load");
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<SafeWriteResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy("load");
    void fetchJson<SafePayload>(`/api/lights/${lightId}/safe`)
      .then((payload) => {
        if (cancelled) return;
        setRead(payload.safe);
        setDraft({ ...payload.safe.settings });
        setNotice(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setNotice(caught instanceof Error ? caught.message : "Safe settings did not load.");
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [lightId]);

  const fields = read?.fingerprint.fields ?? [];
  const writable = Boolean(read?.fingerprint.writable) && !unreachable;

  function patch<K extends keyof WledSafeSettings>(key: K, value: WledSafeSettings[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setResult(null);
    setNotice(null);
  }

  async function write() {
    if (!draft || !read) return;
    const settings: Partial<WledSafeSettings> = {};
    for (const key of fields) {
      const value = draft[key];
      if (value !== null && value !== undefined && value !== read.settings[key]) {
        settings[key] = value as never;
      }
    }
    if (requestedFields(settings).length === 0) return;
    setBusy("write");
    setNotice(null);
    const res = await postJson<SafePayload>(`/api/lights/${lightId}/safe`, { settings });
    setBusy(null);
    const payload = res.data as SafePayload;
    if (payload.safe) {
      setRead(payload.safe);
      setDraft({ ...payload.safe.settings });
    }
    if (payload.safeWrite) setResult(payload.safeWrite);
    if (payload.light) onUpdated?.(payload);
    if (res.ok) {
      window.dispatchEvent(new Event("nightplot:lights-changed"));
    }
    if (!res.ok) {
      setNotice(payload.message ?? payload.safeWrite?.message ?? "Safe settings were not written.");
    }
  }

  if (busy === "load" && !read) {
    return <p className="text-[13px] text-quiet">Reading /json/cfg…</p>;
  }

  if (!read || !draft) {
    return (
      <p className="text-[13px] text-destructive">
        {notice ?? "Safe settings did not load."}
      </p>
    );
  }

  const failed = result && !result.matched;
  const sentKeys = failed ? requestedFields(result.sent) : [];

  const formDirty = JSON.stringify(draft) !== JSON.stringify(read.settings);

  return (
    <div className="flex flex-col gap-4">
      {embedded ? null : (
      <div className="flex flex-col gap-1">
        <h2 className="text-[20px] font-semibold">Safe settings</h2>
        <p className="text-[13px] leading-5 text-[#c9c3b8]">
          The small set this firmware actually exposed. Fields we don’t understand stay off the
          form — they are not written.
        </p>
      </div>
      )}

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
        <div className="grid gap-3 md:grid-cols-2">
          <SafeField
            present={fields.includes("displayName")}
            label="Device display name"
            hint="Apply writes this name to WLED, not just to this Light. The hostname below is separate. /json/info may keep the old name until reboot."
          >
            <Input
              value={draft.displayName ?? ""}
              onChange={(event) => patch("displayName", event.target.value)}
              aria-label="Device display name"
              className="font-sans"
              maxLength={32}
            />
            {staleInfoName ? (
              <p className="text-[12px] text-muted-foreground">
                /json/info still reports {staleInfoName} until reboot. The title uses the name
                from /json/cfg.
              </p>
            ) : null}
          </SafeField>
          <SafeField
            present={fields.includes("turnOnAtBoot")}
            label="Turn on at boot"
            hint="After power-up or reset."
          >
            <button
              type="button"
              role="switch"
              aria-checked={draft.turnOnAtBoot === true}
              aria-label="Turn on at boot"
              onClick={() => patch("turnOnAtBoot", draft.turnOnAtBoot !== true)}
              className={cn(
                "relative h-5 w-[34px] rounded-full",
                draft.turnOnAtBoot === true ? "bg-primary" : "bg-input",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full bg-foreground",
                  draft.turnOnAtBoot === true ? "left-4" : "left-0.5",
                )}
              />
            </button>
          </SafeField>
          <SafeField
            present={fields.includes("bootBrightness")}
            label="Boot brightness"
            hint="1–255. Applied at boot, not a live look."
          >
            <Input
              inputMode="numeric"
              value={draft.bootBrightness ?? ""}
              onChange={(event) =>
                patch("bootBrightness", Number.parseInt(event.target.value, 10) || 0)
              }
              aria-label="Boot brightness"
            />
          </SafeField>
          <SafeField
            present={fields.includes("bootPreset")}
            label="Boot preset"
            hint="0 means none."
          >
            <Input
              inputMode="numeric"
              value={draft.bootPreset ?? ""}
              onChange={(event) =>
                patch("bootPreset", Number.parseInt(event.target.value, 10) || 0)
              }
              aria-label="Boot preset"
            />
          </SafeField>
          <SafeField
            present={fields.includes("defaultTransition")}
            label="Default transition"
            hint="Milliseconds. Stored as 100 ms units on the controller."
          >
            <Input
              inputMode="numeric"
              value={transitionMs(draft.defaultTransition) ?? ""}
              onChange={(event) =>
                patch(
                  "defaultTransition",
                  transitionUnitsFromMs(Number.parseInt(event.target.value, 10) || 0),
                )
              }
              aria-label="Default transition in milliseconds"
            />
          </SafeField>
          <SafeField
            present={fields.includes("currentLimitMa")}
            label="Global current limit"
            hint="Milliamps. 0 turns ABL off."
          >
            <Input
              inputMode="numeric"
              value={draft.currentLimitMa ?? ""}
              onChange={(event) =>
                patch("currentLimitMa", Number.parseInt(event.target.value, 10) || 0)
              }
              aria-label="Global current limit in milliamps"
            />
          </SafeField>
        </div>
      )}

      {fields.length > 0 && !read.refuse ? (
        <p className="text-[12px] text-quiet">
          Fingerprint {read.fingerprint.firmware ?? "unknown"} · {fields.map(fieldLabel).join(" · ")}
        </p>
      ) : null}

      {failed ? (
        <div className="flex flex-col gap-2 rounded-[14px] border border-[#5a2f33] bg-[#1a1113] p-4">
          <span className="text-[16px] font-semibold text-destructive">{result.message}</span>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
            <span className="text-muted-foreground">Sent</span>
            <span className="font-mono">{formatSafeWriteLine(result.sent, sentKeys)}</span>
            <span className="text-muted-foreground">Read back</span>
            <span className="font-mono text-destructive">
              {formatSafeWriteLine(
                result.read,
                sentKeys.length > 0 ? sentKeys : requestedFields(result.read),
              )}
            </span>
          </div>
          <p className="text-[12px] text-primary">{result.caption}</p>
        </div>
      ) : null}

      {result?.matched ? (
        <p className="text-[13px] text-primary">{result.message}</p>
      ) : null}
      {notice && !failed ? <p className="text-[13px] text-destructive">{notice}</p> : null}
      {!failed && !read.refuse && !unreachable ? (
        <p className="text-[12px] text-primary">{read.caption}</p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          onClick={() => {
            setDraft({ ...read.settings });
            setResult(null);
            setNotice(null);
          }}
          disabled={busy !== null}
        >
          Revert
        </Button>
        <Button
          variant={formDirty ? "default" : "outline"}
          onClick={() => void write()}
          disabled={!writable || !formDirty || busy !== null}
        >
          {busy === "write" ? "Writing…" : "Apply settings"}
        </Button>
        {busy === "write" ? <GlowingLedLoader label="Applying Safe settings" /> : null}
      </div>
    </div>
  );
}

function formatSafeWriteValue(
  key: SafeFieldKey,
  value: WledSafeSettings[SafeFieldKey] | undefined,
): string {
  if (value === null || value === undefined) return "—";
  switch (key) {
    case "turnOnAtBoot":
      return value ? "on" : "stay off";
    case "defaultTransition":
      return typeof value === "number" ? `${transitionMs(value)} ms` : "—";
    case "currentLimitMa":
      return `${value} mA`;
    default:
      return String(value);
  }
}

function formatSafeWriteLine(settings: Partial<WledSafeSettings>, keys: SafeFieldKey[]): string {
  if (keys.length === 0) return "—";
  return keys
    .map((key) => `${fieldLabel(key)} ${formatSafeWriteValue(key, settings[key])}`)
    .join(" · ");
}

function SafeField({
  present,
  label,
  hint,
  children,
}: {
  present: boolean;
  label: string;
  hint: string;
  children: ReactNode;
}) {
  if (!present) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-[#3a4150] bg-[#0e1014] p-4">
        <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
          {label}
        </span>
        <p className="text-[13px] leading-5 text-quiet">
          This firmware doesn’t expose {label.toLowerCase()}. Not written.
        </p>
      </div>
    );
  }
  return (
    <label className="flex flex-col gap-2 rounded-xl border border-border bg-[#0e1014] p-4">
      <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
        {label}
      </span>
      {children}
      <span className="text-[12px] text-quiet">{hint}</span>
    </label>
  );
}
