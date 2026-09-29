"use client";

import {
  canDelete,
  deleteProgress,
  deleteRefuseReason,
  type DeleteCheck,
} from "@nightplot/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LedLoader } from "@/components/ui/led-loader";
import { Button } from "@/components/ui/button";
import { deleteJson, fetchJson } from "@/lib/api";
import { cn } from "@/lib/utils";

export function DeleteLight({
  lightId,
  name,
  initialChecks,
  alwaysOpen = false,
}: {
  lightId: string;
  name: string;
  initialChecks?: DeleteCheck[] | null;
  alwaysOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(alwaysOpen);
  const [checks, setChecks] = useState<DeleteCheck[]>(initialChecks ?? []);
  const [caption, setCaption] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "delete" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open is the trigger
  }, [open, lightId]);

  async function refresh() {
    setBusy("check");
    setNotice(null);
    try {
      const next = await fetchJson<{ checks: DeleteCheck[]; caption?: string }>(
        `/api/lights/${lightId}/delete-checks`,
      );
      setChecks(next.checks);
      setCaption(next.caption ?? null);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Checks did not finish.");
    }
    setBusy(null);
  }

  async function remove() {
    if (!canDelete(checks)) {
      setNotice(deleteRefuseReason(checks));
      return;
    }
    setBusy("delete");
    setNotice(null);
    const res = await deleteJson<{ message?: string }>(`/api/lights/${lightId}`);
    setBusy(null);
    if (!res.ok) {
      const payload = res.data as { message?: string; checks?: DeleteCheck[] };
      if (payload.checks) setChecks(payload.checks);
      setNotice(payload.message ?? deleteRefuseReason(checks));
      return;
    }
    router.push("/");
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-[13px] text-quiet hover:text-foreground"
      >
        Remove this Light
      </button>
    );
  }

  const progress = deleteProgress(checks);
  const unlocked = canDelete(checks);
  const reason = deleteRefuseReason(checks);

  return (
    <div className="flex flex-col gap-4 rounded-[14px] border border-[#3a4150] bg-[#12141a] p-[22px]">
      <div className="flex flex-col gap-1">
        <span className="text-[20px] font-semibold">Delete {name} from Nightplot?</span>
        <span className="text-muted-foreground">
          {unlocked
            ? "All 3 checks complete"
            : "Checking what this removes before it can go."}
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
          You can add it back from Add a Light any time. The controller is not changed.
        </p>
      ) : (
        <p className="text-[13px] text-primary">
          {reason ?? "Unlocks when every check is complete."}
        </p>
      )}
      {caption ? <p className="text-[12px] text-primary">{caption}</p> : null}
      {notice ? <p className="text-[13px] text-destructive">{notice}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {unlocked ? (
          <Button
            type="button"
            variant={alwaysOpen ? "outline" : "default"}
            className={
              alwaysOpen
                ? "h-9 border-destructive text-destructive hover:bg-[#1a1113]"
                : "h-[52px] bg-destructive text-primary-foreground hover:bg-[#c45c5c] sm:h-10 sm:min-w-[220px]"
            }
            disabled={busy !== null}
            onClick={() => void remove()}
          >
            {busy === "delete" ? "Removing…" : alwaysOpen ? `Remove ${name}` : `Delete ${name}`}
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
              Delete · {progress.done} of {progress.total} checks
            </span>
          </div>
        )}
        {busy === "delete" ? <LedLoader label="Removing Light" /> : null}
        {!unlocked ? (
          <span className="text-[13px] text-primary sm:ml-1">
            Unlocks when every check is complete.
          </span>
        ) : null}
        {alwaysOpen ? null : (
        <Button
          type="button"
          variant="outline"
          className="h-12 sm:ml-auto sm:h-10"
          onClick={() => {
            setOpen(false);
            setNotice(null);
          }}
        >
          Keep it
        </Button>
        )}
      </div>
    </div>
  );
}
