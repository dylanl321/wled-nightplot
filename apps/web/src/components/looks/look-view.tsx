"use client";

import {
  isLook,
  lookIncludesProp,
  patchStyle,
  propMode,
  propStyle,
  sectionMode,
  sectionStyle,
  sectionsFollow,
  setPropMode,
  setSectionMode,
  styleDotColour,
  type Look,
  type LookMode,
  type LookStyle,
} from "@nightplot/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { postJson } from "@/lib/api";
import { CaptureDialog } from "./dialogs";
import { EffectPicker, PalettePicker, StyleEditor, effectOf, effectPatch } from "./style-editor";
import { duplicateLook, kindPlural, readRecent, rememberDeleted, writeRecent } from "./looks-helpers";
import { useLooks, type LightLite, type LooksPayload } from "./use-looks";
import { StyleStrip, YardCanvas } from "./yard-canvas";

type PreviewState = { on: boolean; rows: { lightId: string; lightName: string; status: string; detail: string }[]; message: string | null };

export function LookView({ initial, lights, lookId, startProp }: { initial: LooksPayload; lights: LightLite[]; lookId: string; startProp: string | null }) {
  const router = useRouter();
  const state = useLooks(initial, lights);
  const { doc, setDoc, flush, saveState, saveError, props, drawn, allPropIds, catalog, now } = state;
  const look = doc.looks.find((row) => row.id === lookId) ?? null;
  const [sel, setSel] = useState<string[]>(startProp && props.some((prop) => prop.id === startProp) ? [startProp] : []);
  const [section, setSection] = useState<string | null>(null);
  const [panel, setPanel] = useState<"effects" | "palettes" | null>(null);
  const [fxq, setFxq] = useState("");
  const [clip, setClip] = useState<LookStyle | null>(null);
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const [toast, setToast] = useState<string | null>(null);
  const [capture, setCapture] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ on: false, rows: [], message: null });
  const inspector = useRef<HTMLElement | null>(null);

  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 6000); return () => clearTimeout(id); }, [toast]);

  const setLook = useCallback((update: (look: Look) => Look) => {
    setDoc((current) => ({ ...current, looks: current.looks.map((row) => (row.id === lookId ? update(row) : row)) }));
  }, [lookId, setDoc]);

  // ---------------------------------------------------------------- Preview on lights
  const previewOn = preview.on;
  const sendPreview = useCallback(async (next: Look) => {
    const result = await postJson<{ rows: PreviewState["rows"]; message: string }>(`/api/looks/${next.id}/preview`, { look: next });
    if (!result.ok) { setPreview({ on: false, rows: [], message: result.data.message ?? "Preview did not start." }); setToast(result.data.message ?? "Preview did not start."); return; }
    setPreview({ on: true, rows: result.data.rows, message: result.data.message });
  }, []);
  const endPreview = useCallback(async (quiet = false) => {
    setPreview({ on: false, rows: [], message: null });
    const result = await postJson<{ message: string }>("/api/looks/preview/end", {});
    if (!quiet) setToast(result.ok ? result.data.message : result.data.message ?? "Preview did not end cleanly. Check the lights.");
  }, []);
  useEffect(() => {
    if (!previewOn || !look) return;
    const id = setTimeout(() => { void sendPreview(look); }, 250);
    return () => clearTimeout(id);
  }, [look, previewOn, sendPreview]);
  const previewRef = useRef(previewOn);
  useEffect(() => { previewRef.current = previewOn; });
  useEffect(() => () => { if (previewRef.current) void postJson("/api/looks/preview/end", {}); }, []);

  const done = useCallback(async () => {
    if (previewOn) await endPreview(true);
    await flush();
    router.push(`/looks?saved=${encodeURIComponent(lookId)}`);
  }, [endPreview, flush, lookId, previewOn, router]);

  // ---------------------------------------------------------------- editing
  const selProps = useMemo(() => sel.map((id) => props.find((prop) => prop.id === id)).filter((prop): prop is NonNullable<typeof prop> => Boolean(prop)), [props, sel]);
  const one = selProps.length === 1 ? selProps[0]! : null;

  const editedStyle: LookStyle | null = useMemo(() => {
    if (!look) return null;
    if (!selProps.length) return look.style;
    if (one && section) return sectionStyle(look, one, section) ?? propStyle(look, one);
    const own = selProps.find((prop) => propMode(look, prop) === "own");
    return propStyle(look, own ?? selProps[0]!);
  }, [look, one, section, selProps]);

  const patch = useCallback((change: Partial<LookStyle>) => {
    setLook((current) => {
      if (!selProps.length) return patchStyle(current, allPropIds, {}, change);
      if (one && section) return patchStyle(current, allPropIds, { prop: one, sectionId: section }, change);
      return selProps.reduce((acc, prop) => patchStyle(acc, allPropIds, { prop }, change), current);
    });
    const colours = [change.color, change.color2, change.color3].filter((c): c is string => Boolean(c) && c !== "#000000");
    if (colours.length) setRecent((list) => { const next = [...colours.filter((c) => !list.includes(c)), ...list].slice(0, 8); writeRecent(next); return next; });
  }, [allPropIds, one, section, selProps, setLook]);

  const setMode = useCallback((mode: LookMode, only?: string) => {
    setLook((current) => {
      if (!only && one && section) return setSectionMode(current, allPropIds, one, section, mode);
      const list = only ? props.filter((prop) => prop.id === only) : selProps;
      return list.reduce((acc, prop) => setPropMode(acc, allPropIds, prop, mode), current);
    });
  }, [allPropIds, one, props, section, selProps, setLook]);

  const pick = useCallback((hit: { propId: string; index: number } | null, event: PointerEvent) => {
    setPanel(null);
    if (!hit) { setSel([]); setSection(null); return; }
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      setSel((list) => (list.includes(hit.propId) ? list.filter((id) => id !== hit.propId) : [...list, hit.propId]));
      setSection(null);
      return;
    }
    const drawnProp = drawn.find((row) => row.id === hit.propId);
    if (look && sel.length === 1 && sel[0] === hit.propId && drawnProp?.sections.length && lookIncludesProp(look, hit.propId)) {
      setSection(drawnProp.lights[hit.index]?.sectionId ?? null);
    } else { setSel([hit.propId]); setSection(null); }
    inspector.current?.scrollTo(0, 0);
  }, [drawn, look, sel]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector(".lk .scrim")) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") { (event.target as HTMLElement).blur(); return; }
      if (panel) setPanel(null);
      else if (section) setSection(null);
      else if (sel.length) setSel([]);
      else void done();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [done, panel, section, sel.length]);

  if (!look) {
    return (
      <div className="lk scoped"><div className="page"><div className="pagein">
        <h1 style={{ fontFamily: "var(--serif)", fontSize: 24 }}>That Look is not in the library</h1>
        <p className="note">It may have been deleted. <Link href="/looks">Back to Looks</Link></p>
      </div></div></div>
    );
  }

  const effectFor = (style: LookStyle | null) => (style ? effectOf(style.fx, catalog.effects) : null);
  const dotFor = (style: LookStyle | null) => styleDotColour(style, effectFor(style)) ?? "transparent";
  const usedIn = doc.playlists.filter((row) => row.lookIds.includes(look.id));
  const onCount = props.filter((prop) => lookIncludesProp(look, prop.id)).length;
  const kinds = [...new Set(props.map((prop) => prop.kind))].filter((kind) => props.filter((prop) => prop.kind === kind).length > 1);
  const showing = preview.rows.filter((row) => row.status === "showing");
  const notShowing = preview.rows.filter((row) => row.status !== "showing");

  const editor = (style: LookStyle, opts: { mixed?: boolean; isLook?: boolean } = {}) => (
    <StyleEditor style={style} effects={catalog.effects} palettes={catalog.palettes} recent={recent} canPaste={clip !== null}
      mixed={opts.mixed ?? false} isLook={opts.isLook ?? false} onPatch={patch} onPanel={setPanel}
      onCopy={() => { setClip(style); setToast("Style copied."); }}
      onPaste={() => { if (clip) patch(opts.isLook ? clip : { ...clip, bri: style.bri }); }} />
  );

  const modeSeg = (current: LookMode | null, forSection = false) => (
    <div className="seg3" role="group" aria-label="How it lights">
      {(["follow", "own", "off"] as const).map((mode) => (
        <button type="button" key={mode} aria-pressed={current === mode} onClick={() => setMode(mode)}>
          {mode === "follow" ? (forSection ? "Follow prop" : "Follow Look") : mode === "own" ? "Own style" : "Off"}
        </button>
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (panel === "effects" && editedStyle) {
    body = <EffectPicker style={editedStyle} effects={catalog.effects} missing={catalog.missing} caption={catalog.caption} query={fxq} onQuery={setFxq}
      onBack={() => setPanel(null)} onPick={(effect) => { patch(effectPatch(effect, editedStyle)); setPanel(null); }} />;
  } else if (panel === "palettes" && editedStyle) {
    body = <PalettePicker style={editedStyle} palettes={catalog.palettes} onBack={() => setPanel(null)} onPick={(pal) => { patch({ pal }); setPanel(null); }} />;
  } else if (selProps.length > 1) {
    const modes = new Set(selProps.map((prop) => propMode(look, prop)));
    const mode = modes.size === 1 ? [...modes][0]! : null;
    const mixed = new Set(selProps.map((prop) => JSON.stringify(propStyle(look, prop)))).size > 1;
    body = (
      <>
        <div className="title"><h1>{selProps.length} props</h1><p className="sub">{selProps.map((prop) => prop.label).join(", ")}</p></div>
        {modeSeg(mode)}
        {mode === null ? <p className="note">They&apos;re set differently. Pick one to set them all.</p> : null}
        {mode === "own" || mode === null ? editor(editedStyle ?? look.style, { mixed }) : mode === "follow" ? <p className="note">They use the Look style. Pick Own style to give them their own.</p> : null}
        <div className="btnrow"><button type="button" className="btn" onClick={() => { setSel([]); setSection(null); }}>Back to the whole Look</button></div>
      </>
    );
  } else if (one) {
    const drawnProp = drawn.find((row) => row.id === one.id);
    const mode = propMode(look, one);
    const sec = section ? drawnProp?.sections.find((row) => row.id === section) ?? null : null;
    const secMode = sec ? sectionMode(look, one.id, sec.id) : null;
    body = (
      <>
        <div className="title"><h1>{one.label}{sec ? ` › ${sec.name}` : ""}</h1>
          <p className="sub">{sec ? `Lights ${sec.first + 1}–${sec.last + 1}` : `${one.kind} · ${drawnProp?.lights.length ?? 0} lights`} · in “{look.name}”</p></div>
        {sec ? modeSeg(secMode, true) : modeSeg(mode)}
        {drawnProp?.sections.length && mode !== "off" ? (
          <div>
            <h2 className="cap">Sections</h2>
            <div className="secchips">
              <button type="button" aria-pressed={!section} onClick={() => setSection(null)}>Whole prop</button>
              {drawnProp.sections.map((row) => {
                const m = sectionMode(look, one.id, row.id);
                return (
                  <button type="button" key={row.id} aria-pressed={section === row.id} onClick={() => setSection(row.id)}>
                    <span className="dot" style={{ background: dotFor(sectionStyle(look, one, row.id)) }} />{row.name}{m === "off" ? " · off" : m === "own" ? " · own" : ""}
                  </button>
                );
              })}
            </div>
            <p className="note" style={{ marginTop: 6 }}>{sectionsFollow(look, one.id) ? "Every section follows, so the effect runs along the whole prop." : "Sections are set separately, so each one runs its own effect."}</p>
          </div>
        ) : null}
        {sec
          ? secMode === "own" ? editor(sectionStyle(look, one, sec.id) ?? propStyle(look, one))
            : secMode === "follow" ? <p className="note">Uses {one.label}&apos;s style. Pick Own style to change just {sec.name}.</p>
              : <p className="note">{sec.name} stays dark in this Look.</p>
          : mode === "own" ? editor(propStyle(look, one))
            : mode === "follow" ? (
              <div className="box"><p className="note">Uses the Look style: <b>{effectOf(look.style.fx, catalog.effects).name}</b>.</p>
                <StyleStrip style={look.style} /><p className="note">Pick Own style to give {one.label} its own effect and colours.</p></div>
            ) : <p className="note">{one.label} stays dark in this Look.</p>}
        <div className="btnrow"><button type="button" className="btn" onClick={() => { setSel([]); setSection(null); }}>Back to the whole Look</button></div>
      </>
    );
  } else {
    body = (
      <>
        <div className="title"><h1>{look.name}</h1><p className="sub">{onCount} of {props.length} props on · {usedIn.length ? `in ${usedIn.map((row) => row.name).join(", ")}` : "not in a playlist"}</p></div>
        <label className="f">Name
          <input className="in" defaultValue={look.name} key={look.id} maxLength={32} autoFocus={/^Look \d+$/.test(look.name)}
            onFocus={(event) => { if (/^Look \d+$/.test(event.target.value)) event.target.select(); }}
            onChange={(event) => { const name = event.target.value.trim().slice(0, 32); if (name) setLook((current) => ({ ...current, name })); }} />
        </label>
        <div>
          <h2 className="cap">Props</h2>
          {props.length === 0 ? <p className="note">No props yet. Draw one on the yard first.</p> : null}
          <div>
            {props.map((prop) => {
              const mode = propMode(look, prop);
              return (
                <div className="proprow" key={prop.id}>
                  <button type="button" onClick={() => { setSel([prop.id]); setSection(null); }}>
                    <span className="dot" style={{ background: mode === "off" ? "transparent" : dotFor(propStyle(look, prop)) }} />{prop.label}
                  </button>
                  <span className="mini3" role="group" aria-label={`${prop.label} in this Look`}>
                    {(["follow", "own", "off"] as const).map((m) => (
                      <button type="button" key={m} aria-pressed={mode === m} onClick={() => setMode(m, prop.id)}>{m === "follow" ? "Follow" : m === "own" ? "Own" : "Off"}</button>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="note" style={{ marginTop: 6 }}>Follow uses the Look style below. Own gives the prop its own effect and colours. Click a name to edit it.</p>
          <div className="btnrow" style={{ marginTop: 6 }}>
            {kinds.map((kind) => (
              <button type="button" key={kind} className="btn small" onClick={() => { setSel(props.filter((prop) => prop.kind === kind).map((prop) => prop.id)); setSection(null); }}>Select all {kindPlural(kind)}</button>
            ))}
            {onCount < props.length ? <button type="button" className="btn small" onClick={() => setLook((current) => props.reduce((acc, prop) => (propMode(acc, prop) === "off" ? setPropMode(acc, allPropIds, prop, "follow") : acc), current))}>Switch every prop on</button> : null}
          </div>
        </div>
        <div><h2 className="cap">Look style · for props set to Follow</h2>{editor(look.style, { isLook: true })}</div>
        <label className="f">Fade in (seconds)
          <input className="in num" type="number" min={0} max={25} step={0.1} defaultValue={(look.transitionTenths ?? 7) / 10}
            onChange={(event) => { const v = Number(event.target.value); if (Number.isFinite(v) && v >= 0) setLook((current) => ({ ...current, transitionTenths: Math.min(255, Math.round(v * 10)) })); }} />
        </label>
        <details className="fold">
          <summary>More <span className="meta">WLED preset {look.slot}</span></summary>
          <div className="foldbody">
            <p className="note">This Look is WLED preset {look.slot} on every Light.</p>
            <div className="btnrow">
              <button type="button" className="btn small" onClick={async () => {
                const copy = duplicateLook(doc, look);
                if (!copy) { setToast("Every preset number is taken."); return; }
                setDoc((current) => ({ ...current, looks: [...current.looks, copy] }));
                await flush();
                router.push(`/looks/${copy.id}`);
              }}>Duplicate</button>
              <button type="button" className="btn small" onClick={() => setCapture(true)}>Start from what a Light shows…</button>
              <button type="button" className="btn small danger" onClick={async () => {
                const scheduled = doc.schedule && (doc.schedule.rows ?? [{ run: doc.schedule.run }]).some((row) => row.run.kind === "look" && row.run.lookId === look.id);
                if (scheduled) { setToast("The Schedule runs this Look. Change that row first."); return; }
                if (!window.confirm(`Delete ${look.name}? It's removed from playlists too. Undo is on the Looks page.`)) return;
                rememberDeleted(look, doc.playlists);
                if (previewOn) await endPreview(true);
                setDoc((current) => ({
                  ...current,
                  looks: current.looks.filter((row) => row.id !== look.id),
                  playlists: current.playlists.map((row) => {
                    const keep = row.lookIds.map((id, index) => [id, index] as const).filter(([id]) => id !== look.id);
                    return { ...row, lookIds: keep.map(([id]) => id), ...(row.durationsTenths ? { durationsTenths: keep.map(([, index]) => row.durationsTenths![index] ?? row.durationTenths) } : {}) };
                  }).filter((row) => row.lookIds.length > 0),
                }));
                await flush();
                router.push(`/looks?deleted=${encodeURIComponent(look.id)}`);
              }}>Delete Look</button>
            </div>
          </div>
        </details>
      </>
    );
  }

  const chip = previewOn
    ? `● Previewing on ${showing.length} of ${preview.rows.length} Light${preview.rows.length === 1 ? "" : "s"}${notShowing.length ? ` · ${notShowing.map((row) => `${row.lightName}: ${row.detail}`).join(" · ")}` : ""}`
    : selProps.length ? `${selProps.map((prop) => prop.label).join(", ")}${one && section ? ` › ${drawn.find((row) => row.id === one.id)?.sections.find((row) => row.id === section)?.name ?? ""}` : ""}`
      : "Drawing only · not on the lights";

  return (
    <div className="lk scoped lk-look" style={{ height: "100dvh", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)" }}>
      <header className="top">
        <span className="brand hidephone"><i />Nightplot</span>
        <div className="crumb">
          <Link href="/looks" className="hidephone" onClick={async (event) => { event.preventDefault(); await done(); }}>Looks ›</Link>
          <select aria-label="Look" value={look.id} onChange={async (event) => { await flush(); router.push(`/looks/${event.target.value}`); }}>
            {doc.looks.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </div>
        <span className="spacer" />
        <span className={`note hidephone ${saveState === "error" ? "warnnote" : ""}`} role="status">{saveState === "saving" ? "Saving…" : saveState === "error" ? saveError : "Saved"}</span>
        <button type="button" className="toggle" aria-pressed={previewOn} onClick={() => { if (previewOn) void endPreview(); else void sendPreview(look); }}>
          <span className="sw" /><span className="lbl">Preview on lights</span>
        </button>
        <button type="button" className="btn primary" onClick={() => { void done(); }}>Done</button>
      </header>
      <div className="main" style={{ minHeight: 0 }}>
        <aside className="rail">
          <section>
            <h2 className="cap">Props in {look.name}</h2>
            <ul className="plist">
              {props.map((prop) => {
                const mode = propMode(look, prop);
                return (
                  <li key={prop.id}>
                    <button type="button" className={sel.includes(prop.id) ? "on" : ""} onClick={(event) => {
                      if (event.shiftKey || event.metaKey || event.ctrlKey) setSel((list) => (list.includes(prop.id) ? list.filter((id) => id !== prop.id) : [...list, prop.id]));
                      else setSel([prop.id]);
                      setSection(null); setPanel(null);
                    }}>
                      <span className="dot" style={{ background: mode === "off" ? "transparent" : dotFor(propStyle(look, prop)) }} />{prop.label}
                      <span className="n">{mode === "off" ? "off" : mode === "own" ? "own" : "follows"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="note" style={{ marginTop: 8 }}>Shift-click to select several.</p>
          </section>
          <p className="note">The drawing is close to WLED&apos;s effects, not exact. Preview on lights shows the real thing.</p>
        </aside>
        <div className="stagewrap">
          <YardCanvas className="stage" drawn={drawn} props={props} look={look} labels selected={sel} section={section} dim onPick={pick}
            ariaLabel={`${look.name} drawn on the yard`} />
          <div className={`chip ${previewOn ? "preview" : ""}`} role="status">{chip}</div>
          <div className="stagehint hidephone">Click a prop to select it, click again for a section. Esc goes back.</div>
        </div>
        <aside className="insp" ref={inspector}>{body}</aside>
      </div>
      {capture ? (
        <CaptureDialog lights={lights} now={now} onClose={() => setCapture(false)} onCaptured={(captured) => {
          setLook((current) => {
            let next: Look = { ...current, style: { ...captured.style } };
            for (const row of captured.props) {
              const prop = props.find((item) => item.id === row.propId);
              if (!prop) continue;
              if (row.off || !row.style) next = setPropMode(next, allPropIds, prop, "off");
              else if (JSON.stringify(row.style) === JSON.stringify(captured.style)) next = setPropMode(next, allPropIds, prop, "follow");
              else next = patchStyle(setPropMode(next, allPropIds, prop, "own"), allPropIds, { prop }, row.style);
            }
            return isLook(next) ? next : current;
          });
          setCapture(false);
          setToast(captured.message);
        }} />
      ) : null}
      {toast ? <div className="toast" role="status"><span>{toast}</span></div> : null}
    </div>
  );
}
