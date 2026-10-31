import type { LightsPayload, Prop, PropAttachment } from "@nightplot/shared";
import { AppShell } from "@/components/app-shell";
import { AttachProp } from "@/components/props/attach-prop";
import { ServerDown } from "@/components/server-down";
import { fetchJson } from "@/lib/api";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AttachPropPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lightsResult, propsResult] = await Promise.allSettled([
    fetchJson<LightsPayload>("/api/lights"),
    fetchJson<{ props: Prop[]; attachments: PropAttachment[] }>("/api/props"),
  ]);
  if (lightsResult.status === "rejected" || propsResult.status === "rejected") {
    return <AppShell lightCount={0} nav="lights"><ServerDown detail="Could not open Attach." /></AppShell>;
  }
  const prop = propsResult.value.props.find((row) => row.id === id);
  const lights = lightsResult.value.lights.map((light) => ({
    id: light.id,
    name: light.name,
    outputs: light.outputs,
    ledCount: light.ledCount,
    lastSnapshot: light.lastSnapshot,
    elementCount: light.elementCount,
  }));
  return (
    <AppShell lights={lightsResult.value.lights} lightCount={lightsResult.value.lights.length} nav="lights" sessions={lightsResult.value.sessions}>
      {prop ? (
        <AttachProp
          prop={prop}
          lights={lights}
          props={propsResult.value.props}
          attachments={propsResult.value.attachments}
          sessions={lightsResult.value.sessions ?? []}
        />
      ) : (
        <div className="mx-auto flex max-w-[560px] flex-col gap-3 px-4 py-8">
          <h1 className="text-[26px] font-semibold">That prop is not in the yard</h1>
          <Link href="/" className="inline-flex min-h-11 items-center text-primary">Back to your yard</Link>
        </div>
      )}
    </AppShell>
  );
}
