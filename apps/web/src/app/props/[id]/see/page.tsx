import type { Element, LightDetail, LightsPayload, Prop } from "@nightplot/shared";
import { AppShell } from "@/components/app-shell";
import { SeeProp } from "@/components/props/see-prop";
import { ServerDown } from "@/components/server-down";
import { fetchJson } from "@/lib/api";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SeePropPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const propsResult = await Promise.allSettled([
    fetchJson<{ props: Prop[] }>("/api/props"),
    fetchJson<LightsPayload>("/api/lights"),
  ]);
  const props = propsResult[0];
  const lights = propsResult[1];
  if (!props || props.status === "rejected" || !lights || lights.status === "rejected") {
    return <AppShell lightCount={0} nav="home"><ServerDown detail="Could not open this prop." /></AppShell>;
  }
  const prop = props.value.props.find((row) => row.id === id);
  if (!prop?.lightId) {
    return (
      <AppShell lights={lights.value.lights} lightCount={lights.value.lights.length} nav="home" sessions={lights.value.sessions}>
        <div className="mx-auto flex max-w-[560px] flex-col gap-3 px-4 py-8">
          <h1 className="text-[26px] font-semibold">Attach this prop first</h1>
          <Link href={prop ? `/props/${prop.id}/attach` : "/"} className="inline-flex min-h-11 items-center text-primary">
            {prop ? "Attach" : "Back to your yard"}
          </Link>
        </div>
      </AppShell>
    );
  }
  const detail = await Promise.allSettled([fetchJson<LightDetail>(`/api/lights/${prop.lightId}`)]);
  const loaded = detail[0];
  const elements: Element[] = loaded?.status === "fulfilled"
    ? loaded.value.elements.filter((element) => prop.elementIds.includes(element.id))
    : [];
  return (
    <AppShell immersive lights={lights.value.lights} lightCount={lights.value.lights.length} nav="home" sessions={lights.value.sessions}>
      <SeeProp prop={prop} elements={elements} />
    </AppShell>
  );
}
