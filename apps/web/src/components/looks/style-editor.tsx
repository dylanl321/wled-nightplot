"use client";

import {
  FALLBACK_EFFECTS,
  LOOK_EFFECT_CATEGORIES,
  LOOK_PALETTE_STOPS,
  paletteColourAt,
  type LookEffectInfo,
  type LookPaletteInfo,
  type LookStyle,
} from "@nightplot/shared";
import { StyleStrip } from "./yard-canvas";

export const COLOUR_KEYS = ["color", "color2", "color3"] as const;

export function effectOf(fx: number, effects: readonly LookEffectInfo[]): LookEffectInfo {
  return effects.find((row) => row.fx === fx) ?? FALLBACK_EFFECTS.find((row) => row.fx === fx) ?? {
    fx, name: `Effect ${fx}`, category: "More", colours: ["Colour", "Background", null], sliders: ["Speed", "Intensity"], palette: true, hidden: false,
  };
}

export function paletteName(pal: number, palettes: readonly LookPaletteInfo[]): string {
  return palettes.find((row) => row.pal === pal)?.name ?? LOOK_PALETTE_STOPS[pal]?.name ?? `Palette ${pal}`;
}

export function paletteGradient(style: LookStyle, pal: number): string {
  const stops: string[] = [];
  for (let i = 0; i <= 10; i += 1) {
    const c = paletteColourAt({ ...style, pal }, i / 10.001);
    stops.push(`rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0}) ${i * 10}%`);
  }
  return `linear-gradient(90deg, ${stops.join(",")})`;
}

const DEFAULT_PALETTE: Record<number, number> = { 80: 31, 66: 35, 9: 11, 67: 6 };

/** Picking an effect: its usual palette when the style was on a colour palette. */
export function effectPatch(effect: LookEffectInfo, current: LookStyle): Partial<LookStyle> {
  const def = DEFAULT_PALETTE[effect.fx];
  return { fx: effect.fx, ...(effect.palette && def !== undefined && [0, 2, 3, 4, 5].includes(current.pal) ? { pal: def } : {}) };
}

type EditorProps = {
  style: LookStyle;
  effects: readonly LookEffectInfo[];
  palettes: readonly LookPaletteInfo[];
  mixed?: boolean;
  /** The Look's own style: its brightness is the Look's brightness. */
  isLook?: boolean;
  recent: readonly string[];
  canPaste: boolean;
  onPatch: (patch: Partial<LookStyle>) => void;
  onPanel: (panel: "effects" | "palettes") => void;
  onCopy: () => void;
  onPaste: () => void;
};

export function StyleEditor({ style, effects, palettes, mixed, isLook, recent, canPaste, onPatch, onPanel, onCopy, onPaste }: EditorProps) {
  const effect = effectOf(style.fx, effects);
  const firstColour = effect.colours.findIndex((label) => label !== null);
  const sliders = ([["sx", effect.sliders[0]], ["ix", effect.sliders[1]]] as const).filter(([, label]) => label);
  const level = isLook ? style.bri : style.opacity ?? 255;
  return (
    <div className={`box ${mixed ? "mixed" : ""}`}>
      {mixed ? <p className="warnnote">These props have different styles. A change sets that one thing on all of them.</p> : null}
      <button type="button" className="effrow" onClick={() => onPanel("effects")}>
        <span className="grow"><span><b>{effect.name}</b> <span className="meta">{effect.category}</span></span><StyleStrip style={style} /></span>
        <span className="meta">Change ›</span>
      </button>
      {firstColour >= 0 ? (
        <div className="colours">
          {effect.colours.map((label, index) => {
            if (!label) return null;
            const key = COLOUR_KEYS[index]!;
            const value = style[key] ?? "#000000";
            return (
              <div className="colourrow" key={key}>
                <span>{label}</span>
                <input type="color" value={value} aria-label={`${label} colour`} onChange={(event) => onPatch({ [key]: event.target.value })} />
                <input className="in num" defaultValue={value} key={value} aria-label={`${label} hex`} maxLength={7}
                  onFocus={(event) => event.target.select()}
                  onBlur={(event) => {
                    const hex = event.target.value.trim().replace(/^#?/, "#").toLowerCase();
                    if (/^#[0-9a-f]{6}$/.test(hex)) onPatch({ [key]: hex }); else event.target.value = value;
                  }}
                  onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }} />
              </div>
            );
          })}
          <div className="swatches" aria-label="Recent colours">
            {recent.map((colour) => (
              <button type="button" key={colour} style={{ background: colour }} title={colour} aria-label={`Use ${colour}`}
                onClick={() => onPatch({ [COLOUR_KEYS[firstColour]!]: colour })} />
            ))}
          </div>
          <p className="note">A swatch sets {effect.colours[firstColour]}.</p>
        </div>
      ) : <p className="note">{effect.name} takes its colours from the palette.</p>}
      {effect.palette ? (
        <button type="button" className="effrow" onClick={() => onPanel("palettes")}>
          <span className="grow"><span><b>Palette</b> <span className="meta">{paletteName(style.pal, palettes)}</span></span>
            <i style={{ display: "block", height: 10, borderRadius: 5, background: paletteGradient(style, style.pal) }} /></span>
          <span className="meta">Change ›</span>
        </button>
      ) : null}
      {sliders.map(([key, label]) => (
        <div className="slider" key={key}>
          <span>{label}</span>
          <input type="range" min={0} max={255} value={style[key]} aria-label={label ?? key} onChange={(event) => onPatch({ [key]: Number(event.target.value) })} />
          <output>{Math.round(style[key] / 2.55)}</output>
        </div>
      ))}
      <div className="slider">
        <span>{isLook ? "Look brightness" : "Brightness"}</span>
        <input type="range" min={1} max={255} value={level} aria-label={isLook ? "Look brightness" : "Brightness"}
          onChange={(event) => onPatch(isLook ? { bri: Number(event.target.value) } : { opacity: Number(event.target.value) })} />
        <output>{Math.round(level / 2.55)}</output>
      </div>
      <details className="fold">
        <summary>Direction and more</summary>
        <div className="foldbody">
          <div className="seg3" role="group" aria-label="Direction">
            {([["fwd", "→ From light 1"], ["rev", "← From the end"], ["mirror", "↔ Mirror"]] as const).map(([dir, label]) => (
              <button type="button" key={dir} aria-pressed={(style.dir ?? "fwd") === dir} onClick={() => onPatch({ dir })}>{label}</button>
            ))}
          </div>
          <div className="btnrow">
            <button type="button" className="btn small" onClick={onCopy}>Copy style</button>
            <button type="button" className="btn small" onClick={onPaste} disabled={!canPaste}>Paste style</button>
          </div>
        </div>
      </details>
    </div>
  );
}

export function EffectPicker({ style, effects, missing, caption, query, onQuery, onPick, onBack }: {
  style: LookStyle;
  effects: readonly LookEffectInfo[];
  missing: readonly { fx: number; name: string; lights: string[] }[];
  caption: string;
  query: string;
  onQuery: (value: string) => void;
  onPick: (effect: LookEffectInfo) => void;
  onBack: () => void;
}) {
  const shown = effects.filter((row) => !row.hidden && (!query || row.name.toLowerCase().includes(query.toLowerCase())));
  return (
    <>
      <div className="btnrow"><button type="button" className="btn" onClick={onBack}>‹ Back</button><b style={{ marginLeft: 4 }}>Effect</b></div>
      <input className="in" placeholder="Search effects" aria-label="Search effects" value={query} onChange={(event) => onQuery(event.target.value)} autoFocus />
      {LOOK_EFFECT_CATEGORIES.map((category) => {
        const list = shown.filter((row) => row.category === category);
        if (!list.length) return null;
        return (
          <div key={category}>
            <h2 className="cap">{category}</h2>
            <div className="list" style={{ gap: 6 }}>
              {list.map((effect) => (
                <button type="button" key={effect.fx} className={`effrow ${effect.fx === style.fx ? "on" : ""}`} onClick={() => onPick(effect)}>
                  <span className="grow"><b>{effect.name}</b><StyleStrip style={{ ...style, ...effectPatch(effect, style), fx: effect.fx }} /></span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {shown.length === 0 ? <p className="note">No effect matches “{query}”.</p> : null}
      <p className="note">{caption} Effects that need a 2D matrix or a microphone are hidden.
        {missing.length ? ` Not on every Light, so left out: ${missing.slice(0, 6).map((row) => `${row.name} (missing on ${row.lights.join(", ")})`).join("; ")}${missing.length > 6 ? "…" : ""}.` : ""}
        {" "}The drawing is close for common effects; Preview on lights shows the real thing.</p>
    </>
  );
}

export function PalettePicker({ style, palettes, onPick, onBack }: {
  style: LookStyle;
  palettes: readonly LookPaletteInfo[];
  onPick: (pal: number) => void;
  onBack: () => void;
}) {
  return (
    <>
      <div className="btnrow"><button type="button" className="btn" onClick={onBack}>‹ Back</button><b style={{ marginLeft: 4 }}>Palette</b></div>
      <div className="pals">
        {palettes.map((row) => (
          <button type="button" key={row.pal} className={style.pal === row.pal ? "on" : ""} onClick={() => onPick(row.pal)}>
            {row.name}<i style={{ background: paletteGradient(style, row.pal) }} />
          </button>
        ))}
      </div>
      <p className="note">Colour 1, Colours 1 &amp; 2 and Colour gradient use the colours you picked. The rest are WLED&apos;s built-in palettes; the drawing shows the ones Nightplot knows and a rainbow for the rest.</p>
    </>
  );
}
