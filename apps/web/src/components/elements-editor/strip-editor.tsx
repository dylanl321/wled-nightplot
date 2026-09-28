"use client";

import { isLitBead, isUnknownBead, type BeadColor } from "@nightplot/shared";
import { useRef, type PointerEvent, type ReactNode } from "react";
import {
  beadCenterY,
  boundaryX,
  clientToSvg,
  edgeHit,
  edgeAt,
  neighbourAt,
  elementAt,
  LOCATE_OFF,
  pieces,
  rowTop,
  selectionFacts,
  STRIP,
  stripMetrics,
  type IssueWord,
} from "./ops";
import type { EditorAction, EditorState } from "./use-editor-state";
import type { LocateFrame } from "./use-live-locate";

export function StripEditor({
  svgId,
  label,
  ledCount,
  rgbw,
  state,
  hues,
  issueWord,
  resting,
  live,
  frame,
  liveLabel,
  onLive,
  dispatch,
}: {
  svgId: string;
  label: string;
  ledCount: number;
  rgbw: boolean;
  state: EditorState;
  hues: Record<string, string>;
  issueWord: (id: string) => IssueWord | undefined;
  resting: (index: number) => BeadColor;
  live: boolean;
  frame: LocateFrame | null;
  liveLabel: string;
  onLive: () => void;
  dispatch: (action: EditorAction) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const count = Math.max(ledCount, 1);
  const { rows, width, height } = stripMetrics(count);
  const pitch = STRIP.pitch;
  const scale = pitch / 11;
  const die = 5 * scale;
  const body = 9 * scale;

  function colorAt(index: number): BeadColor {
    if (live && frame?.spans) {
      const span = frame.spans.find((item) => index >= item.start && index < item.stop);
      if (span && span.color !== LOCATE_OFF) return span.color;
      return null;
    }
    if (live && frame && frame.color !== LOCATE_OFF && index >= frame.start && index < frame.stop) {
      return frame.color;
    }
    if (live) return null;
    return resting(index);
  }

  function atEvent(event: PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return null;
    return clientToSvg(event.clientX, event.clientY, svg.getBoundingClientRect(), count);
  }

  const selected =
    state.sel.length === 1 ? (state.els.find((element) => element.id === state.sel[0]) ?? null) : null;
  const cursor = stripCursor(state, count);
  const menu =
    state.menuOpen && state.ledSel && !state.drag
      ? selectionFacts(state.els, state.ledSel)
      : null;

  const colors = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const color = colorAt(index);
    if (isLitBead(color)) colors.add(color);
  }

  let menuStyle: { left: string; top: string } | null = null;
  if (state.ledSel && menu) {
    const row = Math.floor(state.ledSel.start / STRIP.per);
    const rowEnd = Math.min(state.ledSel.stop, (row + 1) * STRIP.per);
    const center = (boundaryX(state.ledSel.start, row) + boundaryX(rowEnd, row)) / 2;
    const left = Math.max(150, Math.min(width - 150, center));
    menuStyle = {
      left: `${(left / width) * 100}%`,
      top: `${((rowTop(row) + 14) / height) * 100}%`,
    };
  }

  const ordered = [...state.els].sort(
    (a, b) => Number(state.sel.includes(a.id)) - Number(state.sel.includes(b.id)),
  );

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={label}
        style={{ display: "block", height: "auto", overflow: "visible", cursor, touchAction: "none", userSelect: "none" }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const hit = atEvent(event);
          if (!hit) return;
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          event.currentTarget.setPointerCapture(event.pointerId);
          dispatch({ type: "down", hit, shift: event.shiftKey });
        }}
        onPointerMove={(event) => {
          const hit = atEvent(event);
          if (!hit) return;
          if (state.drag) dispatch({ type: "move", hit, alt: event.altKey });
          else dispatch({ type: "hover", hover: hit });
        }}
        onPointerUp={() => dispatch({ type: "up" })}
        onPointerCancel={() => dispatch({ type: "up" })}
        onPointerLeave={() => dispatch({ type: "leave" })}
      >
        <defs>
          <linearGradient id={`${svgId}-pcb`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#20242c" />
            <stop offset="45%" stopColor="#171a21" />
            <stop offset="100%" stopColor="#0e1015" />
          </linearGradient>
          {[...colors].map((color) => (
            <radialGradient key={color} id={glowId(svgId, color)} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={color} stopOpacity="0.95" />
              <stop offset="22%" stopColor={color} stopOpacity="0.6" />
              <stop offset="55%" stopColor={color} stopOpacity="0.16" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>
        {Array.from({ length: rows }, (_, row) => {
          const n = Math.min(STRIP.per, count - row * STRIP.per);
          const y = beadCenterY(row);
          const ticks: ReactNode[] = [];
          for (let column = 0; column <= n; column += 1) {
            const boundary = row * STRIP.per + column;
            const x = boundaryX(boundary, row);
            const top = rowTop(row);
            if (column % 10 === 0) {
              ticks.push(
                <line key={`t${row}-${column}`} x1={x} y1={top + 58} x2={x} y2={top + 64} stroke="#3f4552" strokeWidth="1" />,
              );
              if (column < n || row === rows - 1) {
                ticks.push(
                  <text
                    key={`tn${row}-${column}`}
                    x={x}
                    y={top + 75}
                    fontSize="9.5"
                    fill="#7d7870"
                    fontFamily="IBM Plex Mono, monospace"
                    textAnchor={column === 0 ? "start" : column === n ? "end" : "middle"}
                  >
                    {boundary}
                  </text>,
                );
              }
            } else if (column % 5 === 0) {
              ticks.push(
                <line key={`t${row}-${column}`} x1={x} y1={top + 58} x2={x} y2={top + 61} stroke="#2a2e38" strokeWidth="1" />,
              );
            }
          }
          return (
            <g key={row}>
              <rect
                x={STRIP.gutter + STRIP.pad - 1}
                y={y - body / 2}
                width={n * pitch + 2}
                height={body}
                rx="1.5"
                fill={`url(#${svgId}-pcb)`}
                stroke="#2a2e38"
                strokeWidth="0.8"
              />
              <line
                x1={STRIP.gutter + STRIP.pad}
                y1={y - body / 2 + 2 * scale}
                x2={STRIP.gutter + STRIP.pad + n * pitch}
                y2={y - body / 2 + 2 * scale}
                stroke="#8a6848"
                strokeWidth="0.7"
                opacity="0.5"
              />
              <line
                x1={STRIP.gutter + STRIP.pad}
                y1={y + body / 2 - 2 * scale}
                x2={STRIP.gutter + STRIP.pad + n * pitch}
                y2={y + body / 2 - 2 * scale}
                stroke="#8a6848"
                strokeWidth="0.7"
                opacity="0.4"
              />
              <text x="0" y={y + 3.5} fontSize="10.5" fill="#7d7870" fontFamily="IBM Plex Mono, monospace">
                {String(row * STRIP.per).padStart(3, "0")}
              </text>
              {ticks}
            </g>
          );
        })}
        {ordered.map((element) => {
          const word = issueWord(element.id);
          const hue = word ? "#e07070" : (hues[element.id] ?? "#d4a574");
          const isSel = state.sel.includes(element.id);
          const start = Math.max(0, Math.min(count, element.start));
          const stop = Math.max(0, Math.min(count, element.stop));
          if (stop <= start) return null;
          return pieces(start, stop).map((piece, index) => {
            const x0 = boundaryX(piece.a, piece.r);
            const x1 = boundaryX(piece.b, piece.r);
            const y = beadCenterY(piece.r);
            const top = rowTop(piece.r);
            return (
              <g key={`${element.id}-${index}`}>
                <rect
                  x={x0 + 0.5}
                  y={y - 12}
                  width={Math.max(0, x1 - x0 - 1)}
                  height="24"
                  rx="3"
                  fill={hue}
                  fillOpacity={isSel ? 0.16 : 0.07}
                  stroke={hue}
                  strokeOpacity={isSel ? 0.95 : 0.35}
                  strokeWidth={isSel ? 1.4 : 1}
                />
                <path
                  d={`M${x0 + 1.5} ${top + 25}V${top + 20}H${x1 - 1.5}V${top + 25}`}
                  fill="none"
                  stroke={hue}
                  strokeOpacity={isSel ? 1 : 0.7}
                  strokeWidth={isSel ? 1.4 : 1}
                />
                {index === 0 ? (
                  <text x={x0 + 2} y={top + 13} fontSize="11.5">
                    <tspan
                      fontFamily="IBM Plex Sans, sans-serif"
                      fontWeight="500"
                      fill={isSel ? hue : "#ece7dc"}
                    >
                      {element.label}
                    </tspan>
                    <tspan
                      dx="6"
                      fontSize="10.5"
                      fontFamily="IBM Plex Mono, monospace"
                      fill={word ? "#e07070" : "#9a9488"}
                    >
                      {`${element.start}–${element.stop}${word ? ` · ${word}` : ""}`}
                    </tspan>
                  </text>
                ) : null}
              </g>
            );
          });
        })}
        {selected && state.mode === "select" && selected.stop > selected.start
          ? (["start", "end"] as const).map((edge) => {
              const boundary = edge === "start" ? selected.start : Math.min(selected.stop, count);
              const row = Math.floor((edge === "end" ? Math.max(boundary - 1, selected.start) : boundary) / STRIP.per);
              const x = boundaryX(boundary, row);
              const y = beadCenterY(row);
              const active = state.focus.kind === "edge" && state.focus.id === selected.id && state.focus.which === edge;
              const shared = active && neighbourAt(selected, edge, state.els);
              const hue = issueWord(selected.id) ? "#e07070" : (hues[selected.id] ?? "#d4a574");
              return (
                <g key={edge}>
                <rect
                  x={x - (active ? 4 : 3)}
                  y={y - (active ? 17 : 14)}
                  width={active ? 8 : 6}
                  height={active ? 34 : 28}
                  rx="3"
                  fill={active ? "#ece7dc" : hue}
                  stroke="#0c0d10"
                  strokeWidth="1.5"
                />
                {active || state.focus.kind === "seg" ? <>
                  {(active || edge === "start") ? <text x={x - 9} y={y + 4.5} textAnchor="middle" fill={active ? "#ece7dc" : hue} fontSize="14" fontWeight="700">‹</text> : null}
                  {(active || edge === "end") ? <text x={x + 9} y={y + 4.5} textAnchor="middle" fill={active ? "#ece7dc" : hue} fontSize="14" fontWeight="700">›</text> : null}
                </> : null}
                {shared ? <text x={x + 10} y={y - 20} fill="#ece7dc" fontSize="9.5" fontWeight="600">shared</text> : null}
                </g>
              );
            })
          : null}
        {(state.draftRange ?? state.ledSel)
          ? pieces((state.draftRange ?? state.ledSel)!.start, (state.draftRange ?? state.ledSel)!.stop).map(
              (piece, index) => {
                const x0 = boundaryX(piece.a, piece.r);
                const x1 = boundaryX(piece.b, piece.r);
                return (
                  <rect
                    key={`sel-${index}`}
                    x={x0 + 0.5}
                    y={beadCenterY(piece.r) - 14}
                    width={Math.max(0, x1 - x0 - 1)}
                    height="28"
                    rx="4"
                    fill="#ece7dc"
                    fillOpacity="0.08"
                    stroke="#ece7dc"
                    strokeWidth="1.4"
                    strokeDasharray="4 3"
                  />
                );
              },
            )
          : null}
        {Array.from({ length: count }, (_, index) => {
          const color = colorAt(index);
          const row = Math.floor(index / STRIP.per);
          const x = boundaryX(index, row) + pitch / 2;
          const y = beadCenterY(row);
          const lit = isLitBead(color);
          const unknown = isUnknownBead(color);
          return (
            <g key={index}>
              {lit ? (
                <ellipse
                  cx={x}
                  cy={y}
                  rx={pitch * 1.25}
                  ry={pitch * 1.45}
                  fill={`url(#${glowId(svgId, color)})`}
                  opacity="0.85"
                />
              ) : null}
              <rect
                x={x - die / 2}
                y={y - die / 2}
                width={die}
                height={die}
                rx={die * 0.18}
                fill={unknown ? "#2a2926" : lit ? "#efe9dc" : "#3e3c37"}
              />
              {rgbw ? (
                <>
                  <circle cx={x - die * 0.2} cy={y} r={die * 0.2} fill={lit ? color : "#141519"} />
                  <circle cx={x + die * 0.2} cy={y} r={die * 0.2} fill={lit ? "#fff4dc" : "#141519"} />
                </>
              ) : (
                <circle
                  cx={x}
                  cy={y}
                  r={lit ? die * 0.36 : die * 0.3}
                  fill={lit ? color : unknown ? "#1d1d1f" : "#141519"}
                  stroke={lit ? "#ffffff" : undefined}
                  strokeOpacity={lit ? 0.47 : undefined}
                  strokeWidth={lit ? die * 0.12 : 0}
                />
              )}
            </g>
          );
        })}
        {state.cursor !== null ? <Playhead index={state.cursor} count={count} /> : null}
        {state.hover && !state.keyMoved && !state.drag && state.mode !== "locate" && state.mode !== "split" && (state.cursor === null || Math.abs(state.hover.idx - state.cursor) > 4)
          ? <Playhead index={state.hover.idx} count={count} ghost /> : null}
        {state.hover && state.mode === "split" && !state.drag ? <Playhead index={state.hover.b} count={count} cut /> : null}
        {state.markedStart !== null ? (() => {
          const row = Math.floor(state.markedStart / STRIP.per), x = boundaryX(state.markedStart, row), y = beadCenterY(row);
          return <g><path d={`M${x} ${y + 15}V${y - 20}l10 4-10 4`} fill="#d4a574" stroke="#d4a574" /><text x={x + 13} y={y - 13} fill="#d4a574" fontSize="10">start</text></g>;
        })() : null}
      </svg>
      {menu && state.ledSel && menuStyle ? (
        <LedMenu
          state={state}
          hues={hues}
          style={menuStyle}
          liveLabel={liveLabel}
          onLive={onLive}
          dispatch={dispatch}
        />
      ) : null}
    </div>
  );
}

function Playhead({ index, count, ghost = false, cut = false }: { index: number; count: number; ghost?: boolean; cut?: boolean }) {
  const row = Math.max(0, Math.min(Math.floor(index / STRIP.per), Math.ceil(count / STRIP.per) - 1));
  const x = boundaryX(index, row) + (cut ? 0 : STRIP.pitch / 2);
  const top = rowTop(row), text = `${cut ? "cut " : ""}${index}`, width = 10 + text.length * 6.2;
  return <g data-testid={cut ? "cut-marker" : ghost ? "hover-marker" : "cursor-marker"}>
    <line x1={x} y1={top + 16} x2={x} y2={top + 62} stroke={cut ? "#e07070" : "#ece7dc"} strokeOpacity={ghost ? 0.28 : 0.7} strokeWidth="1" strokeDasharray={cut ? "3 2" : undefined} />
    {!cut ? <circle cx={x} cy={beadCenterY(row)} r={STRIP.pitch * 0.68} fill="none" stroke="#ece7dc" strokeOpacity={ghost ? 0.4 : 1} strokeWidth="1.2" /> : null}
    <rect x={x - width / 2} y={top + 64} width={width} height="14" rx="7" fill={cut ? "#e07070" : ghost ? "#2f3542" : "#ece7dc"} />
    <text x={x} y={top + 74.5} fontSize="10" textAnchor="middle" fill={ghost ? "#ece7dc" : "#0c0d10"} fontFamily="IBM Plex Mono, monospace" fontWeight="500">{text}</text>
  </g>;
}

function LedMenu({
  state,
  hues,
  style,
  liveLabel,
  onLive,
  dispatch,
}: {
  state: EditorState;
  hues: Record<string, string>;
  style: { left: string; top: string };
  liveLabel: string;
  onLive: () => void;
  dispatch: (action: EditorAction) => void;
}) {
  const range = state.ledSel;
  if (!range) return null;
  const facts = selectionFacts(state.els, range);
  const count = range.stop - range.start;
  const newLabel = facts.hit.length
    ? facts.inside
      ? `New Segment · cut out of ${facts.inside.label}`
      : "New Segment · take these LEDs"
    : "New Segment";
  const sub =
    facts.hit.length === 0
      ? "All free"
      : facts.inside
        ? `Inside ${facts.inside.label}`
        : `${facts.free} free · overlaps ${facts.hit.map((element) => element.label).join(", ")}`;
  return (
    <div
      className="absolute z-10 flex w-[280px] -translate-x-1/2 -translate-y-full flex-col overflow-hidden rounded-xl border border-[#3a4150] bg-[#12141a] shadow-[0_16px_40px_rgba(0,0,0,0.6)]"
      style={style}
    >
      <div className="flex flex-col gap-0.5 border-b border-border px-3 py-2.5">
        <span className="font-mono text-[13px] font-medium">
          {count} LED{count === 1 ? "" : "s"} · {range.start}–{range.stop}
        </span>
        <span className="text-[12px] text-muted-foreground">{sub}</span>
      </div>
      <div className="flex flex-col p-1">
        <MenuButton className="font-semibold text-primary" hint="N" onClick={() => dispatch({ type: "new-from-sel" })}>
          {newLabel}
        </MenuButton>
        {facts.extend.map((element) => (
          <MenuButton key={element.id} onClick={() => dispatch({ type: "extend", id: element.id })}>
            <span className="size-2 rounded-[2px]" style={{ background: hues[element.id] }} />
            Add to {element.label}
          </MenuButton>
        ))}
        {facts.hit.length > 0 ? (
          <MenuButton onClick={() => dispatch({ type: "select-here" })}>
            {facts.hit.length === 1 ? `Select ${facts.hit[0]!.label}` : `Select ${facts.hit.length} Segments`}
          </MenuButton>
        ) : null}
        <MenuButton className="text-online" onClick={onLive}>
          {liveLabel}
        </MenuButton>
        {facts.hit.length > 0 ? (
          <MenuButton
            className="text-destructive"
            hint="⌫"
            onClick={() => dispatch({ type: "remove-from" })}
          >
            Remove from {facts.hit.map((element) => element.label).join(", ")}
          </MenuButton>
        ) : null}
        <MenuButton className="text-muted-foreground" hint="Esc" onClick={() => dispatch({ type: "clear-led" })}>
          Clear selection
        </MenuButton>
      </div>
    </div>
  );
}

function MenuButton({
  children,
  className,
  hint,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-[#1a1d24] ${className ?? ""}`}
    >
      <span className="flex flex-1 items-center gap-2.5">{children}</span>
      {hint ? <span className="font-mono text-[11px] font-normal text-muted-foreground">{hint}</span> : null}
    </button>
  );
}

function stripCursor(state: EditorState, ledCount: number): string {
  if (state.mode === "locate") return "crosshair";
  if (state.drag) {
    if (state.drag.kind === "move") return "grabbing";
    if (state.drag.kind === "draw") return "crosshair";
    return "ew-resize";
  }
  if (state.mode === "split") return "col-resize";
  if (state.mode === "range") return "cell";
  if (!state.hover) return "crosshair";
  const selected =
    state.sel.length === 1 ? (state.els.find((element) => element.id === state.sel[0]) ?? null) : null;
  if (edgeHit(state.hover, selected, ledCount)) return "ew-resize";
  const found = elementAt(state.hover.idx, state.els);
  if (found && edgeAt(state.hover.idx, found)) return "ew-resize";
  if (found) return "grab";
  return "crosshair";
}

function glowId(svgId: string, color: string): string {
  return `${svgId}-g${color.slice(1)}`;
}
