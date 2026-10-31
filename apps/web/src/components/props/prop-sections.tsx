"use client";

import {
  countLayout,
  describeIndexRanges,
  designFromLayout,
  extendEdge,
  formatTypedRanges,
  parseTypedRanges,
  pathEdgeIndexRanges,
  sectionIndexRanges,
  wellHouseEdgeLabel,
  type PropIndexRange,
  type PropLayout,
  type PropMeasurements,
  type PropSection,
} from "@nightplot/shared";
import { useEffect, useMemo, useState } from "react";

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
  const [edgeId, setEdgeId] = useState<string | null>(layout.run.find((edge) => edge.kind === "lit")?.id ?? null);
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
    const edgeIds = active.edgeIds.includes(id)
      ? active.edgeIds.filter((edge) => edge !== id)
      : [...active.edgeIds, id];
    patchActive({ edgeIds });
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

  function nudge(delta: number) {
    if (!edgeId) return;
    onLayout(extendEdge(layout, edgeId, delta * layout.pitchM));
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[15px] leading-6">Tap edges to add or remove them from this section. The numbers follow the path.</p>
      <PathFigure
        layout={layout}
        sections={sections}
        activeId={active?.id ?? ""}
        selectedEdgeId={edgeId}
        labels={labels}
        onEdge={toggle}
      />
      {active ? (
        <p className="text-[17px] font-medium leading-6">{report ? describeIndexRanges(report.ranges) : "No LEDs in this section yet."}</p>
      ) : null}
      <div className="flex flex-col gap-2">
        {edgeChoices(layout, active).map((edge) => {
          const on = active?.edgeIds.includes(edge.id) ?? false;
          const name = labels.get(edge.id) ?? wellHouseEdgeLabel(edge.id) ?? edge.id;
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
      {selected ? (
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[15px]">{labels.get(selected.edgeId) ?? selected.edgeId}</p>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" aria-label="Fewer lights on this edge" className="min-h-11 min-w-11 rounded-lg border border-border text-[20px]" onClick={() => nudge(-1)}>−</button>
            <span className="min-w-8 text-center font-mono text-[16px]">{selected.lights}</span>
            <button type="button" aria-label="More lights on this edge" className="min-h-11 min-w-11 rounded-lg border border-border text-[20px]" onClick={() => nudge(1)}>+</button>
          </div>
        </div>
      ) : null}
      {active ? (
        <>
          <label className="flex flex-col gap-2 text-[15px]">
            Section name
            <input
              aria-label="Section name"
              value={active.name}
              onChange={(event) => patchActive({ name: event.target.value.slice(0, 64) || active.name })}
              className="min-h-11 w-full rounded-md border border-input bg-[#07080a] px-3 text-base text-foreground outline-none focus:border-primary"
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-[15px]">
            Colour
            <input
              aria-label="Section colour"
              type="color"
              value={active.color ?? "#ffb000"}
              onChange={(event) => patchActive({ color: event.target.value })}
              className="h-11 w-14 cursor-pointer rounded-md border border-border bg-transparent"
            />
          </label>
          <label className="flex flex-col gap-2 text-[15px]">
            Pinned ranges
            <input
              aria-label="Pinned ranges"
              value={draft}
              placeholder="10-16, 50-66"
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-11 w-full rounded-md border border-input bg-[#07080a] px-3 text-base text-foreground outline-none focus:border-primary"
            />
          </label>
          <p className="text-[13px] leading-5 text-muted-foreground">Type lights by hand when you want a range that stays put. 10-16 includes both ends.</p>
          {problem ? <p className="text-[15px] text-destructive">{problem}</p> : null}
          {!problem && (typed.warnings[0] || report?.warnings[0]) ? (
            <p className="text-[15px] text-amber-200">{typed.warnings[0] ?? report?.warnings[0]}</p>
          ) : null}
        </>
      ) : (
        <p className="text-[15px] text-muted-foreground">Add a section, then tap the edges that belong to it.</p>
      )}
      <ul className="flex flex-col gap-2">
        {sections.map((section) => {
          const row = reports.find((item) => item.sectionId === section.id);
          return (
            <li key={section.id}>
              <button
                type="button"
                aria-pressed={section.id === active?.id}
                onClick={() => setActiveId(section.id)}
                className={`flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 text-left ${section.id === active?.id ? "border-primary bg-card" : "border-border"}`}
              >
                <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: section.color ?? "#888" }} />
                <span className="min-w-0 flex-1 truncate text-[15px]">{section.name}</span>
                <span className="shrink-0 text-[13px] text-muted-foreground">{row ? rangeCount(row.ranges) : 0}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
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

function edgeChoices(layout: PropLayout, active: PropSection | null) {
  const lit = layout.run.filter((edge) => edge.kind === "lit");
  const wall = active?.id.match(/^wall\.(\d+)$/)?.[1];
  if (wall != null) {
    return lit.filter((edge) => edge.id.endsWith(`.${wall}`) || active?.edgeIds.includes(edge.id));
  }
  if (lit.length <= 8) return lit;
  return lit.filter((edge) => active?.edgeIds.includes(edge.id));
}

function rangeCount(ranges: readonly PropIndexRange[]): number {
  return ranges.reduce((sum, range) => sum + Math.max(0, range.stop - range.start), 0);
}

function PathFigure({
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
  const bounds = boundsOf(layout);
  if (!bounds) return null;
  const colourOf = new Map<string, string>();
  for (const section of sections) {
    for (const id of section.edgeIds) {
      if (!colourOf.has(id)) colourOf.set(id, section.color ?? "#8a8478");
    }
  }
  const active = sections.find((section) => section.id === activeId);
  const span = Math.max(bounds.width, bounds.height, layout.pitchM * 4);
  const hit = span * 0.08;
  return (
    <div className="h-[200px] w-full overflow-hidden rounded-xl border border-border bg-[#0e1014]">
      <svg
        aria-label="Prop path"
        viewBox={`${bounds.minX - span * 0.08} ${bounds.minY - span * 0.08} ${bounds.width + span * 0.16} ${bounds.height + span * 0.16}`}
        className="h-full w-full touch-manipulation"
      >
        <g transform={`translate(0 ${bounds.minY + bounds.maxY}) scale(1 -1)`}>
          {layout.run.map((edge) => {
            const from = layout.corners.find((corner) => corner.id === edge.from);
            const to = layout.corners.find((corner) => corner.id === edge.to);
            if (!from || !to || edge.kind === "wire") return null;
            const on = active?.edgeIds.includes(edge.id) ?? false;
            const colour = on ? (active?.color ?? "#ffb000") : (colourOf.get(edge.id) ?? "#4a463c");
            const name = labels.get(edge.id) ?? wellHouseEdgeLabel(edge.id) ?? edge.id;
            return (
              <g key={edge.id} role="button" tabIndex={0} aria-label={name} aria-pressed={on} onClick={() => onEdge(edge.id)} onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onEdge(edge.id);
                }
              }}>
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth={hit} strokeLinecap="round" />
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={colour}
                  strokeWidth={edge.id === selectedEdgeId ? span * 0.035 : span * 0.02}
                  strokeLinecap="round"
                />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function boundsOf(layout: PropLayout): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of layout.corners) {
    minX = Math.min(minX, corner.x);
    minY = Math.min(minY, corner.y);
    maxX = Math.max(maxX, corner.x);
    maxY = Math.max(maxY, corner.y);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: Math.max(0.01, maxX - minX), height: Math.max(0.01, maxY - minY) };
}
