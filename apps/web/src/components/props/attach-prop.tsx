"use client";

import {
  planPropPlacement,
  type Light,
  type Prop,
  type PropAttachment,
} from "@nightplot/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api";

export function AttachProp({
  prop,
  lights,
  props,
  attachments,
  sessions = [],
}: {
  prop: Prop;
  lights: {
    id: string;
    name: string;
    outputs?: Light["outputs"];
    ledCount: number;
    lastSnapshot?: Light["lastSnapshot"];
    elementCount?: number;
  }[];
  props: Prop[];
  attachments: PropAttachment[];
  sessions?: { lightId: string; kind: "preview" | "blink" }[];
}) {
  const router = useRouter();
  const [lightId, setLightId] = useState(lights[0]?.id ?? "");
  const light = lights.find((row) => row.id === lightId) ?? null;
  const outputs = light?.outputs ?? [];
  const [outputId, setOutputId] = useState(outputs[0]?.id ?? "");
  const output = outputs.find((row) => row.id === outputId) ?? outputs[0] ?? null;
  const followers = props.filter((row) => {
    if (row.id === prop.id) return false;
    const attachment = attachments.find((item) => item.propId === row.id);
    return attachment?.lightId === lightId && attachment.outputId === (output?.id ?? outputId);
  });
  const [afterPropId, setAfterPropId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blinkDone, setBlinkDone] = useState(false);
  const blinking = !blinkDone && sessions.some((session) => session.lightId === lightId && session.kind === "blink");

  const plan = light && output
    ? planPropPlacement({
      prop,
      output,
      lightName: light.name,
      place: afterPropId ? { startIndex: null, afterPropId } : { startIndex: 0, afterPropId: null },
      props,
      attachments,
      maxSegments: light.lastSnapshot?.maxSegments ?? null,
      otherRangeCount: Math.max(0, (light.elementCount ?? 0) - prop.elementIds.length),
    })
    : null;

  async function endBlink() {
    if (!light) return;
    setBusy(true);
    const res = await postJson(`/api/lights/${light.id}/blink/end`, {});
    setBusy(false);
    if (!res.ok) {
      setNotice(res.data.message ?? "Blink is still running.");
      return;
    }
    setBlinkDone(true);
    setNotice(null);
  }

  async function apply() {
    if (!light || !output || !plan?.ok) return;
    setBusy(true);
    setNotice(null);
    if (blinking) {
      const ended = await postJson(`/api/lights/${light.id}/blink/end`, {});
      if (!ended.ok) {
        setBusy(false);
        setNotice(ended.data.message ?? "End Blink, then Apply.");
        return;
      }
      setBlinkDone(true);
    }
    const res = await postJson<{ message?: string; summary?: string; apply?: { matched?: boolean; message?: string; caption?: string } }>(
      `/api/props/${prop.id}/attach`,
      {
        lightId: light.id,
        outputId: output.id,
        startIndex: afterPropId ? null : 0,
        afterPropId,
        apply: true,
      },
    );
    setBusy(false);
    if (!res.ok) {
      setApplied(false);
      setNotice(res.data.message ?? "Nothing was sent.");
      return;
    }
    setSummary(res.data.summary ?? plan.summary);
    const readback = res.data.apply?.message ?? res.data.message;
    setNotice(readback ?? "The controller did not report a readback. Not treating this as done.");
    setApplied(res.data.apply?.matched === true);
    router.refresh();
  }

  if (lights.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col gap-4 px-4 py-6">
        <h1 className="text-[26px] font-semibold">Attach {prop.label}</h1>
        <p className="text-[15px] leading-6 text-muted-foreground">
          No controllers are connected. Connect one, then come back. This prop stays in the yard either way.
        </p>
        <Button asChild size="lg" className="min-h-12 text-base">
          <Link href="/discover">Connect controllers</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col gap-4 px-4 py-6 pb-44">
      <p className="text-[13px] text-muted-foreground">
        <Link href="/" className="underline-offset-2 hover:underline">Your yard</Link>
      </p>
      <h1 className="text-[26px] font-semibold">Attach {prop.label}</h1>
      <p className="text-[15px] text-muted-foreground">
        {prop.design?.ledCount == null ? "Light count unknown" : `${prop.design.ledCount} lights`}
      </p>
      <label className="flex flex-col gap-2 text-[15px]">
        Controller
        <select
          value={lightId}
          onChange={(event) => {
            const next = event.target.value;
            setLightId(next);
            const found = lights.find((row) => row.id === next);
            setOutputId(found?.outputs?.[0]?.id ?? "");
            setAfterPropId(null);
            setApplied(false);
          }}
          className="min-h-11 w-full rounded-md border border-input bg-[#07080a] px-3 text-base"
        >
          {lights.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-2 text-[15px]">
        Output
        <select
          value={output?.id ?? ""}
          onChange={(event) => {
            setOutputId(event.target.value);
            setAfterPropId(null);
            setApplied(false);
          }}
          className="min-h-11 w-full rounded-md border border-input bg-[#07080a] px-3 text-base"
        >
          {outputs.map((row) => (
            <option key={row.id} value={row.id}>output {row.index + 1}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-2 text-[15px]">
        Where on this output
        <select
          value={afterPropId ?? ""}
          onChange={(event) => {
            setAfterPropId(event.target.value || null);
            setApplied(false);
          }}
          className="min-h-11 w-full rounded-md border border-input bg-[#07080a] px-3 text-base"
        >
          <option value="">From the first light</option>
          {followers.map((row) => (
            <option key={row.id} value={row.id}>After {row.label}</option>
          ))}
        </select>
      </label>
      <div className="rounded-[14px] border border-border bg-card p-4">
        <h2 className="text-[15px] font-medium">What gets written</h2>
        <p className="mt-2 text-[15px] leading-6">
          {plan ? (plan.ok ? plan.summary : plan.message) : "Pick a controller output."}
        </p>
        {plan?.ok ? (
          <ul className="mt-3 flex flex-col gap-1">
            {plan.segments.map((segment) => (
              <li key={`${segment.label}-${segment.start}`} className="text-[14px] text-muted-foreground">{segment.label}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 text-[13px] leading-5 text-muted-foreground">
          Apply writes the controller and reads it back.
        </p>
      </div>
      {blinking ? (
        <Button type="button" variant="outline" size="lg" className="min-h-12 text-base" onClick={() => void endBlink()}>
          End Blink
        </Button>
      ) : null}
      {notice ? <p className="text-[15px]">{notice}</p> : null}
      {summary && applied ? <p className="text-[15px] text-muted-foreground">{summary}</p> : null}
      <Button type="button" size="lg" className="min-h-12 text-base" disabled={!plan?.ok || busy} onClick={() => void apply()}>
        {busy ? "Applying…" : "Apply"}
      </Button>
      {applied ? (
        <Button asChild size="lg" className="min-h-12 text-base">
          <Link href={`/props/${prop.id}/see`}>See it</Link>
        </Button>
      ) : null}
    </div>
  );
}
