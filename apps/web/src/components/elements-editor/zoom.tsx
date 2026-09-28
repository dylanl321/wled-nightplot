"use client";

import type { Element } from "@nightplot/shared";
import type { IssueWord } from "./ops";

const BEADS = 25;
const PITCH = 34;

export function StripZoom({
  ledCount,
  elements,
  hues,
  issueWord,
  focus,
  edge,
  caption,
}: {
  ledCount: number;
  elements: readonly Element[];
  hues: Record<string, string>;
  issueWord: (id: string) => IssueWord | undefined;
  focus: number;
  edge: boolean;
  caption: string;
}) {
  const width = BEADS * PITCH;
  const first = Math.round(focus) - 12;
  const cy = 40;
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-border bg-card px-4 py-3.5">
      <div className="flex items-center gap-2.5 text-[12px] text-muted-foreground">
        <span className="text-[13px] font-medium text-foreground">Zoom</span>
        <span>{caption}</span>
      </div>
      <svg viewBox={`0 0 ${width} 92`} width="100%" role="img" aria-label="Zoomed LEDs" style={{ display: "block", height: "auto" }}>
        <rect x="0" y={cy - 7} width={width} height="14" rx="2" fill="#171a21" stroke="#2a2e38" strokeWidth="0.8" />
        {Array.from({ length: BEADS }, (_, offset) => {
          const index = first + offset;
          if (index < 0 || index >= ledCount) return null;
          const x = offset * PITCH;
          const element = elements.find((item) => index >= item.start && index < item.stop) ?? null;
          const hue = element ? (issueWord(element.id) ? "#e07070" : hues[element.id]) : null;
          const focused = !edge && index === focus;
          return (
            <g key={index}>
              {hue ? (
                <rect x={x + 1} y={cy - 17} width={PITCH - 2} height="34" rx="3" fill={hue} fillOpacity="0.12" />
              ) : null}
              <rect x={x + PITCH / 2 - 7} y={cy - 7} width="14" height="14" rx="2.5" fill="#efe9dc" opacity={element ? 1 : 0.45} />
              <circle cx={x + PITCH / 2} cy={cy} r="4.6" fill={hue ?? "#3e3c37"} />
              {focused ? (
                <circle cx={x + PITCH / 2} cy={cy} r="12" fill="none" stroke="#ece7dc" strokeWidth="1.5" />
              ) : null}
              <text
                x={x + PITCH / 2}
                y="78"
                fontSize="11"
                textAnchor="middle"
                fill={focused ? "#ece7dc" : "#9a9488"}
                fontWeight={focused ? 500 : 400}
                fontFamily="IBM Plex Mono, monospace"
              >
                {index}
              </text>
            </g>
          );
        })}
        {elements.flatMap((element) =>
          [element.start, element.stop].map((boundary, side) => {
            const offset = boundary - first;
            if (offset < 0 || offset > BEADS) return null;
            const x = offset * PITCH;
            const hue = issueWord(element.id) ? "#e07070" : hues[element.id];
            return (
              <g key={`${element.id}-${side}`}>
                <line x1={x} y1="6" x2={x} y2="64" stroke={hue} strokeWidth="1.5" />
                <text
                  x={side === 0 ? x + 4 : x - 4}
                  y="14"
                  fontSize="10.5"
                  textAnchor={side === 0 ? "start" : "end"}
                  fill={hue}
                  fontFamily="IBM Plex Sans, sans-serif"
                  fontWeight="500"
                >
                  {side === 0 ? `${element.label} ▸` : `◂ ${element.label}`}
                </text>
              </g>
            );
          }),
        )}
        {edge ? (
          <line
            x1={(focus - first) * PITCH}
            y1="2"
            x2={(focus - first) * PITCH}
            y2="66"
            stroke="#ece7dc"
            strokeWidth="2"
          />
        ) : null}
      </svg>
    </div>
  );
}
