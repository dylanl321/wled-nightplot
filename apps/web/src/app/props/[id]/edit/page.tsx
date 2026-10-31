import type { LightsPayload, Prop, PropAttachment } from "@nightplot/shared";
import { AppShell } from "@/components/app-shell";
import { EditProp } from "@/components/props/edit-prop";
import { ServerDown } from "@/components/server-down";
import { fetchJson } from "@/lib/api";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function EditPropPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lightsResult, propsResult] = await Promise.allSettled([
    fetchJson<LightsPayload>("/api/lights"),
    fetchJson<{ props: Prop[]; attachments: PropAttachment[] }>("/api/props"),
  ]);
  if (lightsResult.status === "rejected" || propsResult.status === "rejected") {
    return <AppShell lightCount={0} nav="lights"><ServerDown detail="Could not open this prop." /></AppShell>;
  }
  const prop = propsResult.value.props.find((row) => row.id === id);
  return (
    <AppShell lights={lightsResult.value.lights} lightCount={lightsResult.value.lights.length} nav="lights" sessions={lightsResult.value.sessions}>
      {prop ? <EditProp prop={prop} /> : (
        <div className="mx-auto flex max-w-[560px] flex-col gap-3 px-4 py-8">
          <h1 className="text-[26px] font-semibold">That prop is not in the yard</h1>
          <Link href="/" className="inline-flex min-h-11 items-center text-primary">Back to your yard</Link>
        </div>
      )}
    </AppShell>
  );
}
