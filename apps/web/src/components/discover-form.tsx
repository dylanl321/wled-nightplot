"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { postPlaceholder } from "@/lib/api";

export function DiscoverForm() {
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(action: "find" | "probe") {
    setBusy(true);
    try {
      const result = await postPlaceholder("/api/discover");
      setMessage(
        action === "find"
          ? result.message
          : address.trim()
            ? `${result.message} Address “${address.trim()}” was not probed.`
            : result.message,
      );
    } catch {
      setMessage("Couldn’t reach the configure server. Nothing was scanned.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-4 rounded-xl border border-[#3a4150] bg-[#12141a] p-[18px]">
        <p className="text-[15px] leading-6 text-[#c9c3b8]">
          When this path is built, candidates will arrive one at a time with
          what was read from them. Blink finds the physical box. Add fails
          closed — a snapshot that can’t be read saves nothing.
        </p>
        <Button
          type="button"
          size="lg"
          className="w-fit"
          disabled={busy}
          onClick={() => void submit("find")}
        >
          {busy ? "Checking…" : "Find Lights"}
        </Button>
      </div>

      <div
        id="address"
        className="flex max-w-[320px] flex-col gap-3.5 rounded-xl border border-border bg-[#0e1014] p-[18px]"
      >
        <span className="font-medium">Type an address</span>
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="host or host:port"
          autoComplete="off"
          spellCheck={false}
          className="h-[42px] rounded-lg border border-[#3a4150] bg-card px-3 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void submit("probe")}
        >
          Check and add
        </Button>
        <p className="text-xs leading-5 text-quiet">
          Some networks hide mDNS. An address will always be available; it is
          not probed in this slice.
        </p>
      </div>

      {message ? (
        <div className="max-w-[520px] rounded-md border-l-2 border-destructive bg-[#1a1113] px-3 py-3">
          <p className="font-medium text-destructive">Nothing added</p>
          <p className="mt-1 text-xs leading-5 text-[#c9c3b8]">{message}</p>
        </div>
      ) : null}
    </>
  );
}
