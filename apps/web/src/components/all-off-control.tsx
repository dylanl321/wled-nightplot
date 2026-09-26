"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { postPlaceholder } from "@/lib/api";

type AllOffControlProps = {
  size: "sidebar" | "thumb";
  caption: string;
};

export function AllOffControl({ size, caption }: AllOffControlProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      const result = await postPlaceholder("/api/all-off");
      setMessage(result.message);
    } catch {
      setMessage("Couldn’t reach the configure server. Nothing was sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="allOff"
        size={size}
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setMessage(null);
        }}
      >
        All Off
      </Button>
      <p className="text-center text-[11px] text-quiet">{caption}</p>
      {open ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-3">
          <p className="text-[12px] leading-5 text-muted-foreground">
            A live Preview would end without restoring its colour. All Off
            orchestration is R5. Confirming still sends nothing to a strip.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="allOff"
              size="default"
              className="w-full"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? "Checking…" : "Confirm All Off"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="default"
              className="w-full"
              onClick={() => {
                setOpen(false);
                setMessage(null);
              }}
            >
              Keep
            </Button>
          </div>
          {message ? (
            <p className="text-[12px] leading-5 text-primary">{message}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
