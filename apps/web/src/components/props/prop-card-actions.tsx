"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { deleteJson, patchJson } from "@/lib/api";

type Mode = "idle" | "rename" | "delete";

/**
 * Rename and Delete for one prop card. Delete asks once, inline, and says
 * what it touches. Nothing here talks to a controller.
 */
export function PropCardActions({ id, label, attached }: { id: string; label: string; attached: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [name, setName] = useState(label);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);

  async function rename() {
    const next = name.trim();
    if (!next) {
      setNote({ text: "Give the prop a name.", failed: true });
      return;
    }
    if (next === label) {
      setMode("idle");
      return;
    }
    setBusy(true);
    const res = await patchJson<{ message?: string }>(`/api/props/${id}`, { label: next });
    setBusy(false);
    if (!res.ok) {
      setNote({ text: res.data.message ?? "The prop was not renamed.", failed: true });
      return;
    }
    setNote({ text: `Renamed to ${next}.`, failed: false });
    setMode("idle");
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    const res = await deleteJson<{ message?: string }>(`/api/props/${id}`);
    setBusy(false);
    if (!res.ok) {
      setNote({ text: res.data.message ?? "The prop was not deleted.", failed: true });
      setMode("idle");
      return;
    }
    router.refresh();
  }

  if (mode === "rename") {
    return (
      <form
        className="mt-3 flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void rename();
        }}
      >
        <label className="flex flex-col gap-1 text-[14px]">
          New name
          <input
            aria-label={`New name for ${label}`}
            value={name}
            maxLength={64}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setName(label);
                setMode("idle");
              }
            }}
            className="min-h-11 w-full rounded-md border border-input bg-[#07080a] px-3 text-base text-foreground outline-none focus:border-primary"
          />
        </label>
        <span className="flex gap-2">
          <Button type="submit" className="min-h-11 flex-1 text-[15px]" disabled={busy}>{busy ? "Saving…" : "Save name"}</Button>
          <Button type="button" variant="outline" className="min-h-11 flex-1 text-[15px]" disabled={busy} onClick={() => { setName(label); setMode("idle"); setNote(null); }}>
            Cancel
          </Button>
        </span>
        {note?.failed ? <p role="alert" className="text-[14px] text-destructive">{note.text}</p> : null}
      </form>
    );
  }

  if (mode === "delete") {
    return (
      <div className="mt-3 flex flex-col gap-2 rounded-lg border border-destructive/60 p-3" role="group" aria-label={`Delete ${label}`}>
        <p className="text-[15px]">Delete {label}?</p>
        <p className="text-[14px] leading-5 text-muted-foreground">
          It leaves the yard and every Look.{" "}
          {attached ? "The controller keeps its lights as they are until the next Apply." : "No controller is contacted."}
        </p>
        <span className="flex gap-2">
          <Button type="button" variant="allOff" className="min-h-11 flex-1 text-[15px]" disabled={busy} onClick={() => void remove()}>
            {busy ? "Deleting…" : "Delete prop"}
          </Button>
          <Button type="button" variant="outline" className="min-h-11 flex-1 text-[15px]" disabled={busy} onClick={() => setMode("idle")}>
            Keep it
          </Button>
        </span>
      </div>
    );
  }

  return (
    <>
      <span className="mt-2 flex gap-2">
        <button type="button" className="min-h-11 px-1 text-[14px] text-muted-foreground underline-offset-4 hover:underline" onClick={() => { setNote(null); setMode("rename"); }}>
          Rename
        </button>
        <button type="button" className="min-h-11 px-1 text-[14px] text-muted-foreground underline-offset-4 hover:underline" onClick={() => { setNote(null); setMode("delete"); }}>
          Delete
        </button>
      </span>
      {note ? <p role={note.failed ? "alert" : "status"} className={`text-[14px] ${note.failed ? "text-destructive" : "text-muted-foreground"}`}>{note.text}</p> : null}
    </>
  );
}
