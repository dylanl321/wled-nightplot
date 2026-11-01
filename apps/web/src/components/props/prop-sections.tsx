"use client";

import {
  countLayout,
  describeIndexRanges,
  designFromLayout,
  sectionLightCount,
  clearEdgeLights,
  formatLength,
  setEdgeLights,
  layoutStrings,
  formatTypedRanges,
  parseTypedRanges,
  pathEdgeIndexRanges,
  sectionIndexRanges,
  wellHouseEdgeLabel,
  type PropLayout,
  type PropMeasurements,
  type PropSection,
} from "@nightplot/shared";
import { useEffect, useMemo, useState } from "react";
import { Circle, Group, Line, Text } from "react-konva";
import { EditorStage, boundsOf as pointBounds, toScreen } from "@/components/canvas";
import { ColourField } from "@/components/ui/colour-field";

const COLOURS = ["#ffb000", "#3d8bfd", "#ff5a5a", "#3dd68c", "#c084fc", "#38bdf8", "#fb7185", "#fbbf24"];

export function PropSectionsStep({
  layout,
  sections,
  measurements,
  onLayout,
  onSections,
  onInvalid,
}: {
  layout: PropLayout;
  sections: PropSection[];
  measurements: PropMeasurements;
  onLayout: (layout: PropLayout) => void;
  onSections: (sections: PropSection[]) => void;
  onInvalid: (message: string | null) => void;
}) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");
  const [edgeId, setEdgeId] = useState<string | null>(sections[0]?.edgeIds[0] ?? layoutStrings(layout).flatMap((string) => string.run).find((edge) => edge.kind === "lit")?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const active = sections.find((section) => section.id === activeId) ?? sections[0] ?? null;
  const labels = useMemo(() => {
    const design = designFromLayout(layout, null, measurements);
    return new Map(design.edges.map((edge) => [edge.id, edge.label]));
  }, [layout, measurements]);
  const reports = useMemo(() => sectionIndexRanges(layout, sections), [layout, sections]);
  const report = reports.find((row) => row.sectionId === active?.id) ?? null;
  const spans = useMemo(() => pathEdgeIndexRanges(layout), [layout]);
  const selected = spans.find((span) => span.edgeId === edgeId) ?? null;
  const draft = active ? drafts[active.id] ?? formatTypedRanges(active.pinnedRanges) : "";
  const typed = parseTypedRanges(draft, countLayout(layout).total);
  const problem = typed.errors[0] ?? report?.errors[0] ?? null;

  useEffect(() => {
    onInvalid(problem);
  }, [onInvalid, problem]);

  function commit(next: PropSection[]) {
    onSections(next);
  }

  function patchActive(patch: Partial<PropSection>) {
    if (!active) return;
    commit(sections.map((section) => section.id === active.id ? { ...section, ...patch } : section));
  }

  function toggle(id: string) {
    setEdgeId(id);
    if (!active) return;
    if (active.edgeIds.includes(id)) {
      patchActive({ edgeIds: active.edgeIds.filter((edge) => edge !== id) });
      return;
    }
    commit(sections.map((section) => {
      if (section.id === active.id) return { ...section, edgeIds: [...section.edgeIds, id] };
      return { ...section, edgeIds: section.edgeIds.filter((edge) => edge !== id) };
    }));
  }

  function setDraft(value: string) {
    if (!active) return;
    setDrafts({ ...drafts, [active.id]: value });
    const parsed = parseTypedRanges(value, countLayout(layout).total);
    if (parsed.errors.length === 0) patchActive({ pinnedRanges: parsed.ranges });
  }

  function addSection() {
    const id = `section-${sections.length + 1}`;
    const unique = sections.some((section) => section.id === id) ? `section-${Date.now()}` : id;
    const next: PropSection = {
      id: unique,
      name: `Section ${sections.length + 1}`,
      edgeIds: [],
      pinnedRanges: [],
      color: COLOURS[sections.length % COLOURS.length],
    };
    setActiveId(unique);
    commit([...sections, next]);
  }

  // The stepper changes how many lights sit on the edge. The edge keeps its
  // length, so no corner moves and no other edge changes.
  function nudge(delta: number) {
    if (!edgeId || !selected) return;
    onLayout(setEdgeLights(layout, edgeId, Math.max(0, selected.lights + delta)));
  }

  const selectedEdge = edgeId
    ? layoutStrings(layout).flatMap((string) => string.run).find((edge) => edge.id === edgeId) ?? null
    : null;
  const selectedLength = selectedEdge ? edgeLength(layout, selectedEdge.from, selectedEdge.to) : 0;

  function chooseSection(id: string) {
    setActiveId(id);
    const section = sections.find((row) => row.id === id);
    const first = section?.edgeIds[0];
    if (first) setEdgeId(first);
  }

  const lightsHere = report ? sectionLightCount(report.ranges) : 0;

  return (
    // Phone: one column. Wide window: the drawing on the left, everything else in a column beside it.
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-x-6 lg:gap-y-4" style={{ overflowAnchor: "none" }}>
      {active ? (
        <div className="flex flex-col gap-4 lg:col-start-2">
          <label className="flex flex-col gap-2 text-[15px]">
            Section name
            <input
              aria-label="Section name"
              value={active.name}
              onChange={(event) => patchActive({ name: event.target.value.slice(0, 64) || active.name })}
              className="min-h-11 w-full rounded-md border border-input bg-[#07080a] px-3 text-base text-foreground outline-none focus:border-primary"
            />
          </label>
          <div className="flex min-h-11 items-center justify-between gap-3 text-[15px]">
            <span>Colour</span>
            <ColourField label="Section colour" value={active.color ?? "#ffb000"} onChange={(color) => patchActive({ color })} />
          </div>
          <p className="text-[17px] font-medium">{lightsHere === 1 ? "1 light" : `${lightsHere} lights`}</p>
        </div>
      ) : (
        <p className="text-[15px] text-muted-foreground lg:col-start-2">Add a section, then tap the edges that belong to it.</p>
      )}
      <ul className="flex flex-col gap-2 lg:col-start-2">
        {sections.map((section) => {
          const row = reports.find((item) => item.sectionId === section.id);
          return (
            <li key={section.id}>
              <button
                type="button"
                aria-pressed={section.id === active?.id}
                onClick={() => chooseSection(section.id)}
                className={`flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 text-left ${section.id === active?.id ? "border-primary bg-card" : "border-border"}`}
              >
                <span className="size-4 shrink-0 rounded-full" style={{ background: section.color ?? "#888" }} />
                <span className="min-w-0 flex-1 truncate text-[15px]">{section.name}</span>
                <span className="shrink-0 text-[13px] text-muted-foreground">{row ? sectionLightCount(row.ranges) : 0}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <SectionFigure
        layout={layout}
        sections={sections}
        activeId={active?.id ?? ""}
        selectedEdgeId={edgeId}
        labels={labels}
        onEdge={toggle}
      />
      <div className="flex flex-col gap-2 lg:col-start-2">
        {edgeChoices(layout, active).map((edge, index) => {
          const on = active?.edgeIds.includes(edge.id) ?? false;
          const raw = labels.get(edge.id) ?? wellHouseEdgeLabel(edge.id) ?? edge.id;
          // "Edge 2, Right side": the edge's own name, so it does not read as a section name.
          const name = `Edge ${index + 1}, ${raw.charAt(0).toLowerCase()}${raw.slice(1)}`;
          return (
            <button
              key={edge.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(edge.id)}
              className={`min-h-11 w-full rounded-xl border px-3 text-left text-[15px] ${on ? "border-primary bg-card" : "border-border"}`}
            >
              {on ? "In this section · " : "Add · "}{name}
            </button>
          );
        })}
      </div>
      <details className="rounded-xl border border-border px-3 py-2 lg:col-start-2">
        <summary className="flex min-h-11 cursor-pointer items-center text-[15px]">Advanced</summary>
        <div className="flex flex-col gap-3 pb-2">
          <p className="text-[15px] leading-6 text-muted-foreground">
            {report && report.ranges.length > 0 ? describeIndexRanges(report.ranges) : "No lights in this section yet."}
          </p>
          {selected ? (
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[15px]">{shortEdgeName(labels.get(selected.edgeId) ?? selected.edgeId)}</p>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" aria-label="Fewer lights on this edge" className="min-h-11 min-w-11 rounded-lg border border-border text-[20px]" onClick={() => nudge(-1)}>−</button>
                <span className="min-w-8 text-center font-mono text-[16px]">{selected.lights}</span>
                <button type="button" aria-label="More lights on this edge" className="min-h-11 min-w-11 rounded-lg border border-border text-[20px]" onClick={() => nudge(1)}>+</button>
              </div>
            </div>
          ) : null}
          {selected && selectedLength > 0 ? (
            <p className="text-[13px] leading-5 text-muted-foreground">
              {selected.lights === 1 ? "1 light" : `${selected.lights} lights`} on {formatLength(selectedLength, layout.units)}
              {selected.lights > 0 ? `, about ${(selectedLength / selected.lights * 100).toFixed(1)} cm apart` : ""}.
              {" "}The edge keeps its length.
              {selectedEdge?.lockedLights != null ? (
                <>
                  {" "}
                  <button type="button" className="underline underline-offset-4" onClick={() => onLayout(clearEdgeLights(layout, selectedEdge.id))}>
                    Count from the length again
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
          {active ? (
            <label className="flex flex-col gap-2 text-[15px]">
              Light numbers
              <input
                aria-label="Pinned ranges"
                value={draft}
                placeholder="10-16, 50-66"
                onChange={(event) => setDraft(event.target.value)}
                className="min-h-11 w-full rounded-md border border-input bg-[#07080a] px-3 text-base text-foreground outline-none focus:border-primary"
              />
            </label>
          ) : null}
          <p className="text-[13px] leading-5 text-muted-foreground">Type lights by hand when you want a range that stays put. 10-16 includes both ends. Light numbers start at 0: the light nearest the wire in is light 0, so a 40-light section is 0-39.</p>
          {problem ? <p className="text-[15px] text-destructive">{problem}</p> : null}
          {!problem ? reports.flatMap((row) => row.warnings).filter((warning, index, all) => all.indexOf(warning) === index).map((warning) => (
            <p key={warning} className="text-[15px] text-amber-200">{warning}</p>
          )) : null}
        </div>
      </details>
      <div className="flex gap-2 lg:col-start-2">
        <button type="button" className="min-h-11 flex-1 rounded-lg border border-border text-base" onClick={addSection}>New section</button>
        {active ? (
          <button
            type="button"
            className="min-h-11 flex-1 rounded-lg border border-border text-base"
            onClick={() => {
              const next = sections.filter((section) => section.id !== active.id);
              setActiveId(next[0]?.id ?? "");
              commit(next);
            }}
          >
            Remove section
          </button>
        ) : null}
      </div>
    </div>
  );
}

function edgeLength(layout: PropLayout, fromId: string, toId: string): number {
  const from = layout.corners.find((corner) => corner.id === fromId);
  const to = layout.corners.find((corner) => corner.id === toId);
  return from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
}

function shortEdgeName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function edgeChoices(layout: PropLayout, _active: PropSection | null) {
  return layoutStrings(layout).flatMap((string) => string.run.filter((edge) => edge.kind === "lit"));
}

/**
 * The prop's path on the editor stage, each run in its section's colour.
 * Tap a run to put it in the selected section, or take it out.
 */
function SectionFigure({
  layout,
  sections,
  activeId,
  selectedEdgeId,
  labels,
  onEdge,
}: {
  layout: PropLayout;
  sections: readonly PropSection[];
  activeId: string;
  selectedEdgeId: string | null;
  labels: Map<string, string>;
  onEdge: (edgeId: string) => void;
}) {
  const bounds = pointBounds(layout.corners);
  if (!bounds) return null;
  const colourOf = new Map<string, string>();
  for (const section of sections) {
    for (const id of section.edgeIds) {
      if (!colourOf.has(id)) colourOf.set(id, section.color ?? "#8a8478");
    }
  }
  const active = sections.find((section) => section.id === activeId);
  const runs = layoutStrings(layout).flatMap((string) => string.run.map((edge, index) => ({ edge, order: index + 1 })));
  return (
    <div className="h-[240px] w-full overflow-hidden rounded-xl border border-border bg-[#0e1014] lg:sticky lg:top-4 lg:col-start-1 lg:row-[1/span_20] lg:h-[72dvh]">
      <EditorStage
        bounds={bounds}
        fitMinSpanM={layout.pitchM * 4}
        limits={{ minPpm: 2, maxPpm: 48 / Math.max(layout.pitchM, 0.005) }}
        label="Prop path"
        testId="section-figure"
        overlay={(camera) =>
          runs.map(({ edge, order }) => {
            const from = layout.corners.find((corner) => corner.id === edge.from);
            const to = layout.corners.find((corner) => corner.id === edge.to);
            if (!from || !to) return null;
            const a = toScreen(from, camera);
            const b = toScreen(to, camera);
            if (edge.kind === "wire") {
              return <Line key={edge.id} points={[a.x, a.y, b.x, b.y]} stroke="#8a8478" strokeWidth={1.5} dash={[6, 4]} listening={false} />;
            }
            const on = active?.edgeIds.includes(edge.id) ?? false;
            const colour = on ? (active?.color ?? "#ffb000") : (colourOf.get(edge.id) ?? "#4a463c");
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const tap = () => onEdge(edge.id);
            return (
              <Group key={edge.id} name={`run ${labels.get(edge.id) ?? edge.id}`} onClick={tap} onTap={tap}>
                <Line points={[a.x, a.y, b.x, b.y]} stroke={colour} strokeWidth={edge.id === selectedEdgeId ? 7 : 4} lineCap="round" hitStrokeWidth={28} />
                <Circle x={mid.x} y={mid.y} radius={10} fill="#12141a" stroke={on ? colour : "#e8e2d6"} listening={false} />
                <Text text={String(order)} x={mid.x - 10} y={mid.y - 6} width={20} align="center" fontSize={11} fill="#e8e2d6" listening={false} />
              </Group>
            );
          })
        }
      />
    </div>
  );
}
