"use client";

import type { Element, Prop } from "@nightplot/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api";

export function SeeProp({
  prop,
  elements,
}: {
  prop: Prop;
  elements: Element[];
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const lightId = prop.lightId;

  useEffect(() => {
    if (!lightId || elements.length === 0) return;
    let stop = false;
    void (async () => {
      await postJson(`/api/lights/${lightId}/blink/end`, {});
      if (stop) return;
      const res = await postJson<{ liveCaption?: string | null; message?: string }>(`/api/lights/${lightId}/preview`, {
        spans: elements.map((element) => ({
          start: element.start,
          stop: element.stop,
          color: element.color?.hex ?? "#ffb000",
        })),
        reread: true,
      });
      if (stop) return;
      if (!res.ok) {
        setNotice(res.data.message ?? "The lights did not change.");
        return;
      }
      const caption = res.data.liveCaption ?? "";
      setNotice(caption.toLowerCase().includes("fixture") || caption.toLowerCase().includes("software")
        ? "The controller answered. Look at the lights to be sure."
        : "The controller is showing these colours.");
    })();
    return () => {
      stop = true;
      if (lightId) void postJson(`/api/lights/${lightId}/preview/end`, {});
    };
  }, [elements, lightId]);

  async function done() {
    if (lightId) await postJson(`/api/lights/${lightId}/preview/end`, {});
  }

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col gap-5 px-4 py-6 pb-28">
      <h1 className="text-[26px] font-semibold">{prop.label}</h1>
      <p className="text-[15px] leading-6 text-muted-foreground">These are the colours you set. This is a preview.</p>
      <div className="flex flex-col gap-2">
        {elements.map((element) => (
          <div key={element.id} className="flex min-h-11 items-center gap-3">
            <span className="h-8 min-w-8 flex-1 rounded-md" style={{ background: element.color?.hex ?? "#888", flexGrow: Math.max(1, element.stop - element.start) }} />
            <span className="shrink-0 text-[14px]">{element.label.replace(`${prop.label} · `, "")}</span>
          </div>
        ))}
      </div>
      {notice ? <p className="text-[15px]">{notice}</p> : null}
      <Button asChild size="lg" className="min-h-12 text-base">
        <Link href="/" onClick={() => void done()}>Done</Link>
      </Button>
    </div>
  );
}
