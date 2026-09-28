"use client";

import {
  allOffConfirmCopy,
  allOffDockCaption,
  allOffRetryLabel,
  allOffRowLabel,
  type AllOffResult,
  type LightView,
} from "@nightplot/shared";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api";
import { cn } from "@/lib/utils";

export type LiveHint = {
  lightId: string;
  kind: "preview" | "blink";
  label: string;
};

type AllOffControlProps = {
  size: "sidebar" | "thumb" | "bar";
  lights: LightView[];
  sessions: LiveHint[];
};

export function AllOffControl({ size, lights, sessions }: AllOffControlProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "confirm" | "result">("idle");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AllOffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const live = sessions[0] ?? null;
  const liveName =
    (live && lights.find((light) => light.id === live.lightId)?.name) || live?.label || "";
  const missingNames = lights
    .filter((light) => light.reachability === "no-answer")
    .map((light) => light.name);
  const onCount = lights.filter((light) => light.reachability === "online" && light.on).length;

  const caption = allOffDockCaption({
    liveKind: live?.kind ?? null,
    lightCount: lights.length,
    onCount,
    missingCount: missingNames.length,
  });

  const confirm = useMemo(
    () =>
      allOffConfirmCopy({
        live: live ? { kind: live.kind, label: live.label, name: liveName } : null,
        lightCount: lights.length,
        missingNames,
      }),
    [live, liveName, lights.length, missingNames.join("|")],
  );

  async function run(lightIds?: string[]) {
    window.dispatchEvent(new CustomEvent("nightplot:all-off", { detail: { lightIds } }));
    setBusy(true);
    setError(null);
    const res = await postJson<AllOffResult>(
      "/api/all-off",
      lightIds?.length ? { lightIds } : {},
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.data.message ?? "All Off did not finish.");
      return;
    }
    setResult(res.data);
    setPhase("result");
    window.dispatchEvent(new Event("nightplot:lights-changed"));
    router.refresh();
  }

  function onAllOff() {
    setError(null);
    if (sessions.length > 0) {
      setPhase("confirm");
      return;
    }
    void run();
  }

  function dismiss() {
    setPhase("idle");
    setResult(null);
    setError(null);
  }

  const retry = result ? allOffRetryLabel(result.rows) : null;
  const failedIds = result?.failedIds ?? [];
  const confirming = phase === "confirm";
  const showingResult = phase === "result" && result !== null;
  const liveSession = sessions.length > 0;

  if (size === "bar") {
    return (
      <>
        {mounted && confirming
          ? createPortal(
              <div
                data-all-off-overlay=""
                className="pointer-events-none fixed inset-0 z-40 bg-black/60"
                aria-hidden
              />,
              document.body,
            )
          : null}
        <div className="relative flex items-center gap-3">
          <p
            suppressHydrationWarning
            className={cn(
              "text-[12px]",
              liveSession ? "text-online" : "text-muted-foreground",
            )}
          >
            {caption}
          </p>
          <Button
            type="button"
            variant="allOff"
            size="bar"
            disabled={busy}
            onClick={() => void onAllOff()}
          >
            {busy ? "Turning off…" : "All Off"}
          </Button>
          {confirming || showingResult ? (
            <div className="absolute top-[calc(100%+8px)] right-0 z-50 w-[380px] rounded-xl border border-destructive bg-[#1a1113] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
              {confirming ? (
                <ConfirmBody
                  confirm={confirm}
                  busy={busy}
                  onRun={() => void run()}
                  onDismiss={dismiss}
                />
              ) : result ? (
                <ResultCard
                  result={result}
                  retry={retry}
                  busy={busy}
                  onRetry={() => void run(failedIds)}
                  onClose={dismiss}
                />
              ) : null}
              {error ? <p className="mt-2 text-[12px] leading-5 text-destructive">{error}</p> : null}
            </div>
          ) : error ? (
            <p className="absolute top-[calc(100%+8px)] right-0 text-[12px] leading-5 text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      {mounted && confirming
        ? createPortal(
            <div
              data-all-off-overlay=""
              className={
                size === "sidebar"
                  ? "pointer-events-none fixed inset-0 z-40 bg-black/60"
                  : "pointer-events-none fixed inset-0 z-40 bg-black/60 lg:hidden"
              }
              aria-hidden
            />,
            document.body,
          )
        : null}
      <div
        className={cn(
          "relative z-30 flex flex-col gap-3",
          confirming &&
            size === "sidebar" &&
            "rounded-xl border border-destructive bg-[#1a1113] p-4 shadow-[0_-20px_50px_rgba(0,0,0,0.6)]",
          (confirming || showingResult) &&
            size === "thumb" &&
            "-mx-4 -mb-3 rounded-t-[22px] border-t border-[#3a4150] bg-[#12141a] px-4 pb-3 pt-4 shadow-[0_-20px_60px_rgba(0,0,0,0.6)]",
        )}
      >
        {size === "thumb" && (confirming || showingResult) ? (
          <div className="mx-auto h-1 w-10 rounded-full bg-[#3a4150]" />
        ) : null}

        {confirming ? (
          <ConfirmBody
            confirm={confirm}
            busy={busy}
            onRun={() => void run()}
            onDismiss={dismiss}
          />
        ) : showingResult && result ? (
          <ResultCard
            result={result}
            retry={retry}
            busy={busy}
            onRetry={() => void run(failedIds)}
            onClose={dismiss}
          />
        ) : (
          <>
            <Button
              type="button"
              variant="allOff"
              size={size}
              disabled={busy}
              onClick={() => void onAllOff()}
            >
              {busy ? "Turning off…" : "All Off"}
            </Button>
            <p className="text-center text-[11px] text-quiet" suppressHydrationWarning>
              {caption}
            </p>
          </>
        )}
        {error ? <p className="text-[12px] leading-5 text-destructive">{error}</p> : null}
      </div>
    </>
  );
}

function ConfirmBody({
  confirm,
  busy,
  onRun,
  onDismiss,
}: {
  confirm: { title: string; ends: string | null; colour: string | null; then: string };
  busy: boolean;
  onRun: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[16px] font-semibold">{confirm.title}</p>
      <div className="flex flex-col gap-2 text-[13px] leading-5 text-[#c9c3b8]">
        {confirm.ends ? (
          <p>
            {confirm.ends} <span className="text-primary">{confirm.colour}</span>
          </p>
        ) : null}
        <p>{confirm.then}</p>
      </div>
      <Button
        type="button"
        className="h-11 w-full bg-destructive text-primary-foreground hover:bg-[#c45c5c]"
        disabled={busy}
        onClick={onRun}
      >
        {busy ? "Turning off…" : "Turn all off"}
      </Button>
      <Button type="button" variant="outline" className="h-9 w-full" onClick={onDismiss}>
        Not now
      </Button>
    </div>
  );
}

function ResultCard({
  result,
  retry,
  busy,
  onRetry,
  onClose,
}: {
  result: AllOffResult;
  retry: string | null;
  busy: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const off = result.rows.filter(
    (row) => row.status === "off" || row.status === "already-off",
  ).length;
  const failed = result.rows.filter(
    (row) => row.status === "failed" || row.status === "unknown",
  ).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2.5">
        <span className="text-[19px] font-semibold">
          {result.rows.length === 0
            ? "Nothing to turn off"
            : `${off} of ${result.rows.length} off`}
        </span>
        {failed > 0 ? (
          <span className="ml-auto text-[12px] text-primary">
            {failed} didn’t answer
          </span>
        ) : null}
      </div>
      <p className="text-[13px] leading-5 text-[#c9c3b8]">{result.message}</p>
      {result.rows.length > 0 ? (
        <div className="flex flex-col overflow-hidden rounded-xl border border-border text-[13px]">
          {result.rows.map((row, index) => {
            const bad = row.status === "failed" || row.status === "unknown";
            return (
              <div
                key={row.lightId}
                className={cn(
                  "flex flex-col gap-0.5 px-3.5 py-3",
                  index < result.rows.length - 1 && "border-b border-border",
                  bad && "bg-[#1a1113]",
                )}
              >
                <div className="flex gap-2">
                  <span>{row.name}</span>
                  <span className={cn("ml-auto", bad && "text-destructive")}>
                    {allOffRowLabel(row.status)}
                  </span>
                </div>
                <span className={cn("font-mono text-[11px]", bad ? "text-[#c9c3b8]" : "text-quiet")}>
                  {row.detail}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      <p className="text-[12px] text-primary">{result.caption}</p>
      {retry ? (
        <Button
          type="button"
          className="h-[52px] w-full"
          disabled={busy}
          onClick={onRetry}
        >
          {busy ? "Retrying…" : retry}
        </Button>
      ) : null}
      <Button type="button" variant="outline" className="h-11 w-full" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}
