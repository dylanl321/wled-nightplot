"use client";

import {
  formatLength,
  formatPhysicalLength,
  ledProductSpacing,
  METRES_PER_FOOT,
  parseLength,
  splitTreeCoverage,
  splitTrunkLabel,
  splitWrapDefaults,
  type LedProduct,
  type SplitTreeString,
  type SplitTrunk,
  type TrunkCover,
} from "@nightplot/shared";
import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/api";
import { CommitField } from "./fields";
import {
  addSplitBranch,
  addSplitString,
  continueSplitString,
  forkSplitBranch,
  removeSplitString,
  setSize,
  resetToTemplate,
  setTrunkEnd,
  setTrunkOut,
  splitSpecOf,
  updateSplitString,
  type Draft,
} from "./model";

/**
 * Numbers for the tree on the canvas. Dragging a joint updates these;
 * typing one moves the drawing. Geometry stays in the prop's unit.
 * A string's spacing and length stay metric.
 */
export function SplitTreePanel({ draft, selection, onChange, onSelect }: {
  draft: Draft;
  selection: string | null;
  onChange: (next: Draft) => void;
  onSelect: (id: string) => void;
}) {
  const [products, setProducts] = useState<LedProduct[]>([]);
  useEffect(() => {
    let live = true;
    void fetchJson<{ products?: LedProduct[] }>("/api/led-products")
      .then((body) => { if (live) setProducts(body.products ?? []); })
      .catch(() => { if (live) setProducts([]); });
    return () => { live = false; };
  }, []);
  const layout = draft.layout;
  const split = draft.split;
  if (!layout || !split) return null;
  const spec = splitSpecOf(draft);
  const planned = spec ? splitTreeCoverage(spec) : null;
  if (!planned) return null;
  const wrap = splitWrapDefaults(layout.units);
  const unit = layout.units;
  const selectedTrunk = trunkOfSelection(selection);
  const selected = planned.trunks.find((trunk) => trunk.id === selectedTrunk);
  const selectedIsFork = Boolean(selected && planned.trunks.some((trunk) => trunk.parentId === selected.id));
  const forkTarget = selected && !selectedIsFork ? selected.id : rightmostTip(planned.trunks);
  return (
    <div className="split-tree">
      <p className="note">
        Drag a circle to move where the trunks meet. Drag a diamond to aim that tip, or drag a branch to carry what grows from it. + forks that tip. The lights wrap round each trunk; the ones on the back are drawn fainter.
      </p>
      <div className="grid2 split-sizes">
        <LengthField
          id="ye-size-height"
          label={`Height (${unit === "ft" ? "ft" : "m"})`}
          units={unit}
          value={draft.sizes.height ?? 0}
          onCommit={(value) => { if (value > 0) onChange(setSize(draft, "height", value)); }}
        />
        <LengthField
          id="ye-size-split"
          label={`Split height (${unit === "ft" ? "ft" : "m"})`}
          units={unit}
          value={draft.sizes.split ?? 0}
          onCommit={(value) => { if (value > 0) onChange(setSize(draft, "split", value)); }}
        />
        <LengthField
          id="ye-size-spacing"
          label={`Tip spacing (${unit === "ft" ? "ft" : "m"})`}
          units={unit}
          value={draft.sizes.spacing ?? 0}
          onCommit={(value) => { if (value > 0) onChange(setSize(draft, "spacing", value)); }}
        />
        <SmallField
          id="ye-size-around"
          label="Around the trunk"
          units={unit}
          value={draft.sizes.around ?? wrap.around}
          onCommit={(value) => onChange(setSize(draft, "around", value))}
        />
        <SmallField
          id="ye-size-gap"
          label="Wrap every"
          units={unit}
          value={draft.sizes.gap ?? wrap.gap}
          onCommit={(value) => onChange(setSize(draft, "gap", value))}
        />
      </div>
      <p className="note">Around is a tape round the trunk at the ground. Branches are thinner than the trunk they grow from.</p>
      {draft.split?.pose ? (
        <button type="button" className="btn link" onClick={() => onChange(resetToTemplate(draft))}>Even tips again</button>
      ) : null}
      <div className="hrow">
        <h2>Trunks</h2>
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (selected && selectedIsFork) onChange(addSplitBranch(draft, selected.id));
            else if (forkTarget) onChange(forkSplitBranch(draft, forkTarget));
          }}
        >
          {selected && selectedIsFork ? "Add branch" : "Fork again"}
        </button>
      </div>
      {planned.trunks.map((trunk) => (
        <TrunkCard
          key={trunk.id}
          trunk={trunk}
          trunks={planned.trunks}
          draft={draft}
          products={products}
          unit={unit}
          cover={planned.cover.find((row) => row.trunkId === trunk.id)}
          hops={planned.hops}
          selected={selectedTrunk === trunk.id}
          onChange={onChange}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function TrunkCard({ trunk, trunks, draft, products, unit, cover, hops, selected, onChange, onSelect }: {
  trunk: SplitTrunk;
  trunks: readonly SplitTrunk[];
  draft: Draft;
  products: readonly LedProduct[];
  unit: "ft" | "m";
  cover: TrunkCover | undefined;
  hops: { stringId: string; fromId: string; toId: string; dark: boolean; back: boolean }[];
  selected: boolean;
  onChange: (next: Draft) => void;
  onSelect: (id: string) => void;
}) {
  const label = splitTrunkLabel(trunk, trunks);
  const strings = (draft.split?.strings ?? []).filter((string) => string.trunkIds.includes(trunk.id));
  const open = cover && cover.openM > 0.02 ? ` · ${formatLength(cover.openM, unit)} still open` : "";
  const around = trunk.radius0 * 2 * Math.PI;
  return (
    <div className={selected ? "trunk on" : "trunk"} data-trunk={trunk.id}>
      <div className="hrow">
        <button type="button" className="btn link" onClick={() => onSelect(`joint:${trunk.id}`)}>{label}</button>
        <span className="meta">{formatSmall(around, unit)} around · {formatLength(cover?.lengthM ?? trunk.lengthM, unit)} of wrap{open}</span>
      </div>
      <div className="grid2">
        <LengthField
          id={`ye-trunk-${trunk.id}`}
          label={`Height (${unit === "ft" ? "ft" : "m"})`}
          units={unit}
          value={trunk.to}
          onCommit={(value) => { if (value > 0) onChange(setTrunkEnd(draft, trunk.id, value)); }}
        />
        <LengthField
          id={`ye-trunk-${trunk.id}-out`}
          label={`Out (${unit === "ft" ? "ft" : "m"})`}
          units={unit}
          value={trunk.x1}
          signed
          onCommit={(value) => onChange(setTrunkOut(draft, trunk.id, value))}
        />
      </div>
      {strings.map((string) => (
        <StringRow
          key={string.id}
          string={string}
          trunk={trunk}
          trunks={trunks}
          draft={draft}
          products={products}
          cover={cover?.strings.find((row) => row.stringId === string.id)}
          hop={hops.find((row) => row.stringId === string.id && (row.fromId === trunk.id || row.toId === trunk.id))}
          onChange={onChange}
        />
      ))}
      <button type="button" className="btn" onClick={() => onChange(addSplitString(draft, trunk.id))}>Add string</button>
    </div>
  );
}

function StringRow({ string, trunk, trunks, draft, products, cover, hop, onChange }: {
  string: SplitTreeString;
  trunk: SplitTrunk;
  trunks: readonly SplitTrunk[];
  draft: Draft;
  products: readonly LedProduct[];
  cover: { coveredM: number; lights: number; remainingM: number | null } | undefined;
  hop: { fromId: string; toId: string; dark: boolean; back: boolean } | undefined;
  onChange: (next: Draft) => void;
}) {
  const first = string.trunkIds[0] === trunk.id;
  const length = string.ledCount != null && string.pitchMm > 0 ? formatPhysicalLength(string.ledCount * string.pitchMm) : null;
  const others = trunks.filter((row) => !string.trunkIds.includes(row.id));
  const note = coverNote(cover);
  const hopTarget = hop ? trunks.find((row) => row.id === (hop.fromId === trunk.id ? hop.toId : hop.fromId)) : undefined;
  const hopLabel = hopTarget ? splitTrunkLabel(hopTarget, trunks) : null;
  const hopSentence = hop && hopLabel ? hopSentenceFor(hop, hopLabel, hop.fromId === trunk.id) : "";
  if (!first) {
    const from = trunks.find((row) => row.id === string.trunkIds[0]);
    return (
      <p className="note">
        {stringLabel(string, products)} continues from {from ? splitTrunkLabel(from, trunks) : "another trunk"}.
        {note ? ` ${note}` : ""}
        {hopSentence}
      </p>
    );
  }
  return (
    <div className="string">
      <div className="hrow">
        <strong>{stringLabel(string, products)}</strong>
        <button type="button" className="btn" onClick={() => onChange(removeSplitString(draft, string.id))}>Remove</button>
      </div>
      <label className="f">LED product
        <select
          value={string.ledProductId ?? ""}
          onChange={(event) => {
            const id = event.target.value;
            const product = products.find((row) => row.id === id);
            const spacing = product ? ledProductSpacing(product) : null;
            onChange(updateSplitString(draft, string.id, {
              ledProductId: id || null,
              ...(spacing ? { pitchMm: spacing.mm } : {}),
            }));
          }}
        >
          <option value="">None</option>
          {products.map((product) => <option key={product.id} value={product.id}>{product.label}</option>)}
        </select>
      </label>
      <div className="grid2">
        <label className="f">Spacing (cm)
          <CommitField
            id={`ye-string-${string.id}-pitch`}
            inputMode="decimal"
            value={formatCm(string.pitchMm)}
            onCommit={(text) => {
              const cm = Number.parseFloat(text);
              if (cm > 0) onChange(updateSplitString(draft, string.id, { pitchMm: cm * 10 }));
            }}
          />
        </label>
        <label className="f">Lights
          <CommitField
            id={`ye-string-${string.id}-count`}
            inputMode="numeric"
            value={string.ledCount == null ? "" : String(string.ledCount)}
            onCommit={(text) => {
              const count = Number.parseInt(text, 10);
              if (Number.isInteger(count) && count >= 0) onChange(updateSplitString(draft, string.id, { ledCount: count }));
            }}
          />
        </label>
      </div>
      <p className="note">
        {length ? `${length} of string.` : "Set how many lights. Length stays in metres."}
        {note ? ` ${note}` : ""}
        {hopSentence}
      </p>
      {string.trunkIds.slice(1).map((id) => {
        const other = trunks.find((row) => row.id === id);
        if (!other) return null;
        return (
          <div key={id} className="hrow">
            <span className="meta">Also on {splitTrunkLabel(other, trunks)}</span>
            <button type="button" className="btn" onClick={() => onChange(removeSplitString(draft, string.id, id))}>Take off</button>
          </div>
        );
      })}
      {others.length > 0 ? (
        <label className="f">Also on
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) onChange(continueSplitString(draft, string.id, event.target.value));
            }}
          >
            <option value="">Choose a trunk</option>
            {others.map((row) => <option key={row.id} value={row.id}>{splitTrunkLabel(row, trunks)}</option>)}
          </select>
        </label>
      ) : null}
    </div>
  );
}

function stringLabel(string: SplitTreeString, products: readonly LedProduct[]): string {
  const product = products.find((row) => row.id === string.ledProductId);
  const index = string.id.replace(/^s/, "");
  return product ? product.label : `String ${index}`;
}

function formatCm(pitchMm: number): string {
  const cm = pitchMm / 10;
  return Number.isInteger(cm) ? String(cm) : String(+cm.toFixed(2));
}

function hopSentenceFor(hop: { dark: boolean; back: boolean }, label: string, leaving: boolean): string {
  if (hop.back) return leaving ? ` Runs back down the back of this branch, then wraps up ${label}.` : ` Comes back down the back of ${label} first.`;
  if (hop.dark) return leaving ? ` Dark jump to ${label}. These trunks do not meet.` : ` Dark jump from ${label}.`;
  return leaving ? ` The wrap continues up ${label}.` : "";
}

function LengthField({ id, label, units, value, signed, onCommit }: {
  id: string;
  label: string;
  units: "ft" | "m";
  value: number;
  signed?: boolean;
  onCommit: (value: number) => void;
}) {
  return (
    <label className="f">{label}
      <CommitField
        id={id}
        inputMode="decimal"
        value={formatProp(value, units)}
        onCommit={(text) => {
          const next = parseProp(text, units);
          if (next == null) return;
          if (!signed && !(next > 0)) return;
          onCommit(next);
        }}
      />
    </label>
  );
}

/** Inches or centimetres, the way a tape round a trunk reads. `value` is in the prop's unit. */
function SmallField({ id, label, units, value, onCommit }: {
  id: string;
  label: string;
  units: "ft" | "m";
  value: number;
  onCommit: (value: number) => void;
}) {
  const k = units === "ft" ? 12 : 100;
  return (
    <label className="f">{label} ({units === "ft" ? "in" : "cm"})
      <CommitField
        id={id}
        inputMode="decimal"
        value={String(+(value * k).toFixed(1))}
        onCommit={(text) => {
          const next = Number.parseFloat(text);
          if (Number.isFinite(next) && next > 0) onCommit(next / k);
        }}
      />
    </label>
  );
}

/** Metres as inches or centimetres. */
function formatSmall(metres: number, units: "ft" | "m"): string {
  return units === "ft" ? `${+(metres / METRES_PER_FOOT * 12).toFixed(1)} in` : `${+(metres * 100).toFixed(1)} cm`;
}

function formatProp(value: number, units: "ft" | "m"): string {
  if (!Number.isFinite(value)) return "";
  if (units === "m") return value.toFixed(2);
  const sign = value < 0 ? "-" : "";
  return `${sign}${formatLength(Math.abs(value) * METRES_PER_FOOT, "ft")}`;
}

function parseProp(text: string, units: "ft" | "m"): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1).trim() : trimmed;
  if (!body) return null;
  if (units === "m" || /^\d+(?:\.\d+)?$/.test(body)) {
    const number = Number(body);
    if (!Number.isFinite(number)) return null;
    return (negative ? -1 : 1) * number;
  }
  const metres = parseLength(body, "ft");
  if (metres == null) return null;
  return (negative ? -1 : 1) * (metres / METRES_PER_FOOT);
}

function trunkOfSelection(selection: string | null): string | null {
  if (!selection) return null;
  const parts = selection.split(":");
  const id = parts[1];
  if (!id || id === "base") return "t0";
  return id;
}

function rightmostTip(trunks: readonly SplitTrunk[]): string | null {
  const leaves = trunks.filter((trunk) => trunk.parentId && !trunks.some((row) => row.parentId === trunk.id));
  if (leaves.length === 0) return null;
  return leaves.reduce((best, trunk) => (trunk.x1 > best.x1 ? trunk : best)).id;
}

function coverNote(cover: { coveredM: number; remainingM: number | null } | undefined): string {
  if (!cover || cover.remainingM == null) return "";
  if (cover.coveredM <= 0) return cover.remainingM <= 0 ? "This string is already used up." : "This string does not reach this trunk.";
  if (cover.remainingM > 0.005) return `${formatPhysicalLength(cover.remainingM * 1000) ?? ""} of string left.`.trim();
  return "The string is used up on this trunk.";
}
