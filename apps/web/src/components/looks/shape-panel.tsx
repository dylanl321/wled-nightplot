"use client";

import {
  SHAPE_MOTIONS,
  SHAPE_MOTION_LABELS,
  SHAPE_SECTION_PLANS,
  applyPropDesign,
  applySectionDesign,
  directionForMotion,
  propShape,
  sectionShapeLights,
  sectionsFromShape,
  shapeSummary,
  similarProps,
  similarSections,
  type Look,
  type LookStyle,
  type Prop,
  type ShapeLight,
  type ShapeMotion,
  type ShapeOverride,
  type ShapeSectionPlan,
} from "@nightplot/shared";
import { useMemo, useState } from "react";
import { patchJson } from "@/lib/api";

type Props = {
  prop: Prop;
  props: readonly Prop[];
  allPropIds: readonly string[];
  /** The section being edited, or null for the whole prop. */
  sectionId: string | null;
  /** The style being edited, when it is the prop's or section's own. Null when it follows or is off. */
  ownStyle: LookStyle | null;
  setLook: (update: (look: Look) => Look) => void;
  onPatch: (change: Partial<LookStyle>) => void;
  onProp: (prop: Prop) => void;
  onToast: (message: string) => void;
  onSection: (sectionId: string | null) => void;
};

const BORDER = "#e0a040";
const INSIDE = "#45b8a8";

/**
 * The prop's shape on the Look page: what the reader found, fixes, sections
 * made from it, which way an effect travels over it, and copying a design to
 * sections and props of the same kind. Nothing here reaches a Light until Send.
 */
export function ShapePanel({ prop, props, allPropIds, sectionId, ownStyle, setLook, onPatch, onProp, onToast, onSection }: Props) {
  const shape = useMemo(() => propShape(prop), [prop]);
  const [busy, setBusy] = useState(false);
  const [confirmPlan, setConfirmPlan] = useState<ShapeSectionPlan | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [pickedProps, setPickedProps] = useState<string[]>([]);
  const targetLights: ShapeLight[] = useMemo(() => {
    if (!shape) return [];
    return sectionId ? sectionShapeLights(prop, shape, sectionId) : [...shape.lights];
  }, [prop, sectionId, shape]);
  const like = useMemo(() => (sectionId ? similarSections(props as Prop[], { propId: prop.id, sectionId }) : []), [prop.id, props, sectionId]);
  const likeProps = useMemo(() => (sectionId ? [] : similarProps(props as Prop[], prop.id)), [prop.id, props, sectionId]);

  if (!shape || shape.lights.length === 0) return null;

  const save = async (body: { sections?: Prop["sections"]; shapeRoles?: ShapeOverride[] }, done: string) => {
    setBusy(true);
    const result = await patchJson<{ prop: Prop }>(`/api/props/${prop.id}`, body);
    setBusy(false);
    if (!result.ok) { onToast(result.data.message ?? "That did not save."); return false; }
    onProp(result.data.prop);
    onToast(done);
    return true;
  };

  const flip = (light: ShapeLight) => {
    const next: ShapeOverride[] = [
      ...(prop.shapeRoles ?? []).filter((row) => !("edgeId" in row && row.edgeId === light.edgeId)),
      { edgeId: light.edgeId, role: light.role === "border" ? "inside" : "border" },
    ];
    void save({ shapeRoles: next }, `That run is now ${light.role === "border" ? "inside" : "border"}. Saved on ${prop.label}.`);
  };

  const makeSections = async (plan: ShapeSectionPlan) => {
    const sections = sectionsFromShape(prop, shape, plan);
    setConfirmPlan(null);
    const ok = await save({ sections }, prop.lightId
      ? `${sections.length} sections made. ${prop.label}'s Light keeps its old segments until you attach the prop again.`
      : `${sections.length} sections made from the shape.`);
    if (ok) onSection(null);
  };

  const fit = ownStyle?.motion && ownStyle.motion !== "wire" ? directionForMotion(targetLights, ownStyle.motion) : null;
  const pickMotion = (motion: ShapeMotion) => {
    if (motion === "wire") { onPatch({ motion: undefined, dir: "fwd" }); return; }
    onPatch({ motion, dir: directionForMotion(targetLights, motion).dir });
  };

  // ---------------------------------------------------------------- drawing
  const xs = shape.lights.map((light) => light.x);
  const ys = shape.lights.map((light) => light.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = shape.pitchM * 1.5;
  const w = Math.max(maxX - minX, shape.pitchM) + pad * 2;
  const h = Math.max(maxY - minY, shape.pitchM) + pad * 2;
  const r = Math.max(shape.pitchM * 0.28, Math.max(w, h) / 160);
  const inTarget = new Set(sectionId ? targetLights.map((light) => `${light.stringId}:${light.index}`) : []);
  const corners = shape.points.filter((point) => point.isCorner);
  const centre = shape.points.find((point) => point.id === shape.centrePointId);
  const fixes = prop.shapeRoles?.length ?? 0;

  return (
    <div className="shape">
      <h2 className="cap">Shape</h2>
      <p className="note">{shapeSummary(shape)}.</p>
      <svg className="shapeview" viewBox={`${minX - pad} ${-(maxY + pad)} ${w} ${h}`} role="img"
        aria-label={`${prop.label}: border lights in amber, inside lights in teal. Tap a light to switch its run.`}>
        {corners.map((point) => (
          <circle key={point.id} cx={point.x} cy={-point.y} r={r * 2.6} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={r * 0.5} />
        ))}
        {centre ? (
          <g stroke="currentColor" strokeOpacity={0.5} strokeWidth={r * 0.5}>
            <line x1={centre.x - r * 3} y1={-centre.y} x2={centre.x + r * 3} y2={-centre.y} />
            <line x1={centre.x} y1={-centre.y - r * 3} x2={centre.x} y2={-centre.y + r * 3} />
          </g>
        ) : null}
        {shape.lights.map((light) => {
          const key = `${light.stringId}:${light.index}`;
          const on = inTarget.has(key);
          return (
            <circle key={key} cx={light.x} cy={-light.y} r={on ? r * 1.5 : r} fill={light.role === "border" ? BORDER : INSIDE}
              fillOpacity={sectionId && !on ? 0.35 : 1} stroke={on ? "currentColor" : "none"} strokeWidth={r * 0.5}
              style={{ cursor: busy ? "wait" : "pointer" }} onClick={() => { if (!busy) flip(light); }}>
              <title>{`Light ${light.index + 1} · ${light.role}`}</title>
            </circle>
          );
        })}
      </svg>
      <p className="note">
        <span className="swatch" style={{ background: BORDER }} /> Border <span className="swatch" style={{ background: INSIDE }} /> Inside · rings are corners{centre ? ", the cross is the centre" : ""}. Tap a light to switch its run.
        {fixes > 0 ? <> <button type="button" className="linkbtn" disabled={busy} onClick={() => { void save({ shapeRoles: [] }, "Shape fixes cleared."); }}>Clear {fixes} fix{fixes === 1 ? "" : "es"}</button></> : null}
      </p>

      {!sectionId ? (
        <div className="shapeblock">
          <h3 className="cap">Sections from the shape</h3>
          <div className="btnrow">
            {SHAPE_SECTION_PLANS.map((plan) => (
              <button type="button" key={plan.id} className="btn small" disabled={busy} title={plan.detail}
                onClick={() => { if (prop.sections?.length) setConfirmPlan(plan.id); else void makeSections(plan.id); }}>{plan.label}</button>
            ))}
          </div>
          {confirmPlan ? (
            <div className="box">
              <p className="note">This replaces {prop.label}&apos;s {prop.sections?.length} section{prop.sections?.length === 1 ? "" : "s"}. Styles set on the old sections in Looks stop applying.{prop.lightId ? " The Light keeps its old segments until you attach the prop again." : ""}</p>
              <div className="btnrow">
                <button type="button" className="btn small" disabled={busy} onClick={() => { void makeSections(confirmPlan); }}>Replace sections</button>
                <button type="button" className="btn small" onClick={() => setConfirmPlan(null)}>Keep them</button>
              </div>
            </div>
          ) : <p className="note">Each section is its own segment on the Light, so it can have its own effect and direction.</p>}
        </div>
      ) : null}

      {ownStyle ? (
        <div className="shapeblock">
          <h3 className="cap">Which way it travels{sectionId ? "" : ` on ${prop.label}`}</h3>
          <div className="secchips" role="group" aria-label="Which way it travels">
            {SHAPE_MOTIONS.map((motion) => (
              <button type="button" key={motion} aria-pressed={(ownStyle.motion ?? "wire") === motion} onClick={() => pickMotion(motion)}>{SHAPE_MOTION_LABELS[motion]}</button>
            ))}
          </div>
          {fit?.note ? <p className="warnnote">{fit.note}</p> : <p className="note">Nightplot works out the WLED direction from the drawing, so it holds when the lights are wired the other way.</p>}
        </div>
      ) : null}

      {sectionId && ownStyle && like.length ? (
        <div className="shapeblock">
          <h3 className="cap">Use this design on</h3>
          <div className="likelist">
            {like.map((row) => {
              const key = `${row.propId}:${row.sectionId}`;
              return (
                <label key={key} className="check">
                  <input type="checkbox" checked={picked.includes(key)} onChange={(event) => setPicked((list) => (event.target.checked ? [...list, key] : list.filter((item) => item !== key)))} />
                  {row.sameProp ? row.sectionName : `${row.propLabel} › ${row.sectionName}`} <span className="note">· {row.lights} lights</span>
                </label>
              );
            })}
          </div>
          <div className="btnrow">
            <button type="button" className="btn small" onClick={() => setPicked(like.map((row) => `${row.propId}:${row.sectionId}`))}>Pick all {like.length}</button>
            <button type="button" className="btn small primary" disabled={picked.length === 0} onClick={() => {
              const targets = like.filter((row) => picked.includes(`${row.propId}:${row.sectionId}`)).map((row) => ({ propId: row.propId, sectionId: row.sectionId }));
              setLook((current) => applySectionDesign(current, allPropIds, props as Prop[], ownStyle, targets));
              onToast(`Design used on ${targets.length} section${targets.length === 1 ? "" : "s"}${ownStyle.motion && ownStyle.motion !== "wire" ? `, each set to travel ${SHAPE_MOTION_LABELS[ownStyle.motion].toLowerCase()}` : ""}.`);
              setPicked([]);
            }}>Use on {picked.length || "picked"}</button>
          </div>
          <p className="note">Sections of the same kind: {targetLights[0]?.role === "inside" ? "inside" : "border"} pieces with the same form.</p>
        </div>
      ) : null}

      {!sectionId && likeProps.length ? (
        <div className="shapeblock">
          <h3 className="cap">Use {prop.label}&apos;s design on similar props</h3>
          <div className="likelist">
            {likeProps.map((row) => (
              <label key={row.propId} className="check">
                <input type="checkbox" checked={pickedProps.includes(row.propId)} onChange={(event) => setPickedProps((list) => (event.target.checked ? [...list, row.propId] : list.filter((item) => item !== row.propId)))} />
                {row.propLabel} <span className="note">· {row.pairs.length} matching sections</span>
              </label>
            ))}
          </div>
          <div className="btnrow">
            <button type="button" className="btn small primary" disabled={pickedProps.length === 0} onClick={() => {
              const targets = likeProps.filter((row) => pickedProps.includes(row.propId));
              setLook((current) => applyPropDesign(current, allPropIds, props as Prop[], prop.id, targets));
              onToast(`${prop.label}'s design used on ${targets.map((row) => row.propLabel).join(", ")}.`);
              setPickedProps([]);
            }}>Use on {pickedProps.length || "picked"}</button>
          </div>
          <p className="note">Props with the same pieces: side for side, inside for inside. Directions are worked out on each one.</p>
        </div>
      ) : null}
    </div>
  );
}
