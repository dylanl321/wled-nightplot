"use client";

import {
  formatLength,
  formatPhysicalLength,
  ledProductSpacing,
  splitTreeCoverage,
  splitTrunkLabel,
  type LedProduct,
  type SplitTreeString,
  type SplitTrunk,
  type TrunkCover,
} from "@nightplot/shared";
import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/api";
import { CommitField } from "./fields";
import {
  addSplitString,
  continueSplitString,
  removeSplitString,
  setSplitLevels,
  setTrunkEnd,
  updateSplitString,
  type Draft,
} from "./model";

/**
 * After the general numbers: each trunk, then the strings on it.
 * Geometry stays in the prop's unit. A string's spacing and length stay metric.
 */
export function SplitTreePanel({ draft, onChange }: {
  draft: Draft;
  onChange: (next: Draft) => void;
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
  const planned = splitTreeCoverage({
    units: layout.units,
    height: draft.sizes.height ?? 0,
    split: draft.sizes.split ?? 0,
    spacing: draft.sizes.spacing ?? 0,
    trunks: Math.round(draft.sizes.trunks ?? 0),
    levels: split.levels,
    trunkTo: split.trunkTo,
    strings: split.strings,
  });
  if (!planned) return null;
  const unit = layout.units;
  return (
    <div className="split-tree">
      <div className="hrow">
        <h2>Trunks</h2>
        <button
          type="button"
          className="btn"
          aria-pressed={split.levels === 2}
          onClick={() => onChange(setSplitLevels(draft, split.levels === 2 ? 1 : 2))}
        >
          {split.levels === 2 ? "Forks again" : "Fork again"}
        </button>
      </div>
      <p className="note">
        {split.levels === 2
          ? "The main trunk splits in two, then those branches split to fill the trunk count. Tip spacing is the distance between neighbouring tips."
          : "One trunk splits into the others at the split height. Tip spacing is the distance between neighbouring tips. Fork again lets a branch split too."}
      </p>
      {planned.trunks.map((trunk) => (
        <TrunkCard
          key={trunk.id}
          trunk={trunk}
          trunks={planned.trunks}
          draft={draft}
          products={products}
          unit={unit}
          cover={planned.cover.find((row) => row.trunkId === trunk.id)}
          hops={planned.hops.filter((hop) => hop.stringId && hop.dark)}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function TrunkCard({ trunk, trunks, draft, products, unit, cover, hops, onChange }: {
  trunk: SplitTrunk;
  trunks: readonly SplitTrunk[];
  draft: Draft;
  products: readonly LedProduct[];
  unit: "ft" | "m";
  cover: TrunkCover | undefined;
  hops: { stringId: string; toId: string; dark: boolean }[];
  onChange: (next: Draft) => void;
}) {
  const label = splitTrunkLabel(trunk, trunks);
  const strings = (draft.split?.strings ?? []).filter((string) => string.trunkIds.includes(trunk.id));
  const open = cover && cover.openM > 0.02 ? ` · ${formatLength(cover.openM, unit)} still open` : "";
  return (
    <div className="trunk">
      <div className="hrow">
        <strong>{label}</strong>
        <span className="meta">{formatLength(trunk.lengthM, unit)} along the trunk{open}</span>
      </div>
      <label className="f">Ends at ({unit === "ft" ? "ft" : "m"})
        <CommitField
          id={`ye-trunk-${trunk.id}`}
          inputMode="decimal"
          value={String(+trunk.to.toFixed(2))}
          onCommit={(text) => {
            const value = Number.parseFloat(text);
            if (value > 0) onChange(setTrunkEnd(draft, trunk.id, value));
          }}
        />
      </label>
      {strings.map((string) => (
        <StringRow
          key={string.id}
          string={string}
          trunk={trunk}
          trunks={trunks}
          draft={draft}
          products={products}
          cover={cover?.strings.find((row) => row.stringId === string.id)}
          hop={hops.find((row) => row.stringId === string.id)}
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
  hop: { toId: string } | undefined;
  onChange: (next: Draft) => void;
}) {
  const first = string.trunkIds[0] === trunk.id;
  const length = string.ledCount != null && string.pitchMm > 0 ? formatPhysicalLength(string.ledCount * string.pitchMm) : null;
  const others = trunks.filter((row) => !string.trunkIds.includes(row.id));
  const note = coverNote(cover);
  const hopLabel = hop ? splitTrunkLabel(trunks.find((row) => row.id === hop.toId) ?? trunk, trunks) : null;
  if (!first) {
    const from = trunks.find((row) => row.id === string.trunkIds[0]);
    return (
      <p className="note">
        {stringLabel(string, products)} continues from {from ? splitTrunkLabel(from, trunks) : "another trunk"}.
        {note ? ` ${note}` : ""}
        {hopLabel ? ` Dark jump to ${hopLabel}.` : ""}
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
        {hopLabel ? ` Dark jump to ${hopLabel}.` : ""}
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

function coverNote(cover: { coveredM: number; remainingM: number | null } | undefined): string {
  if (!cover || cover.remainingM == null) return "";
  if (cover.coveredM <= 0) return cover.remainingM <= 0 ? "This string is already used up." : "This string does not reach this trunk.";
  if (cover.remainingM > 0.005) return `${formatPhysicalLength(cover.remainingM * 1000) ?? ""} of string left.`.trim();
  return "The string is used up on this trunk.";
}
