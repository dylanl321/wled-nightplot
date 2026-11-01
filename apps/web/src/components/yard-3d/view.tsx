"use client";

import { defaultHouse, dragOnGround, lookFrame, snapRoofline, toggleYardMount, turnYardPoint, yardCamera, yardLightPositions, yardLiveColour, yardPlacements, type Look, type Prop, type PropAttachment, type PropYardPoint, type YardHouse, type YardLight, type YardLiveFeed, type YardView } from "@nightplot/shared";
import { fetchJson } from "@/lib/api";
import { CameraControls, Grid, PerformanceMonitor, type CameraControls as CameraControlsImpl } from "@react-three/drei";
import { EffectComposer, SelectiveBloom } from "@react-three/postprocessing";
import { Canvas, useFrame } from "@react-three/fiber";
import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Color, DoubleSide, ExtrudeGeometry, Object3D, Plane, Raycaster, Shape, Vector2, Vector3, type InstancedMesh } from "three";

function allowsGlow(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    return !/swiftshader|llvmpipe|softpipe/i.test(renderer);
  } catch {
    return false;
  }
}

const WARM = "#d4a574";
const VIEWS: { id: YardView; label: string }[] = [
  { id: "street", label: "Street" },
  { id: "overhead", label: "Overhead" },
  { id: "prop", label: "This prop" },
];

export function Yard3dCanvas({
  props,
  picked,
  onPick,
  looks,
  attachments,
  outputs,
  onPlace,
}: {
  props: Prop[];
  picked: string | null;
  onPick: (propId: string | null) => void;
  looks: Look[];
  attachments: PropAttachment[];
  outputs: { lightId: string; outputId: string; start: number }[];
  onPlace: (propId: string, at: PropYardPoint) => Promise<boolean> | boolean;
}) {
  const [view, setView] = useState<YardView>("street");
  const [ready, setReady] = useState(false);
  const [glow, setGlow] = useState(allowsGlow);
  const [dpr, setDpr] = useState(1.25);
  const [pageVisible, setPageVisible] = useState(true);
  const [lookId, setLookId] = useState("");
  const [playing, setPlaying] = useState(false);
  const [feed, setFeed] = useState<YardLiveFeed[]>([]);
  const [word, setWord] = useState<ColourWord>("section");
  const [house, setHouse] = useState<YardHouse | null>(null);
  const [draft, setDraft] = useState<{ id: string; at: PropYardPoint } | null>(null);
  const shown = useMemo(() => props.map((prop) => draft && prop.id === draft.id ? { ...prop, yard: draft.at } : prop), [props, draft]);
  const lights = useMemo(() => coloredLights(shown), [shown]);
  const framed = useMemo(() => coloredLights(props), [props]);
  const pickedPoint = yardPlacements(shown).find((row) => row.propId === picked)?.at;
  const controlsRef = useRef<CameraControlsImpl>(null);
  const lightMesh = useRef<InstancedMesh>(null);
  const houseRef = useRef(house);
  const saveHouseRef = useRef<(next: YardHouse | null) => Promise<void>>(async () => {});
  const dragRef = useRef<{ propId: string; from: { x: number; z: number }; point: PropYardPoint; at: PropYardPoint } | null>(null);
  const ground = useMemo(() => new Plane(new Vector3(0, 1, 0), 0), []);
  const groundHit = useMemo(() => new Vector3(), []);
  async function finishDrag() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (controlsRef.current) controlsRef.current.enabled = true;
    if (!drag) return;
    const prop = props.find((row) => row.id === drag.propId);
    const at = prop?.kind === "roofline" && house ? snapRoofline(drag.at, house) ?? drag.at : drag.at;
    setDraft({ id: drag.propId, at });
    const kept = await onPlace(drag.propId, at);
    if (!kept) setDraft(null);
  }
  function beginDrag(propId: string, from: { x: number; z: number }) {
    const point = yardPlacements(shown).find((row) => row.propId === propId)?.at ?? { x: 0, y: 0 };
    dragRef.current = { propId, from, point, at: point };
    if (controlsRef.current) controlsRef.current.enabled = false;
    onPick(propId);
  }
  const look = looks.find((row) => row.id === lookId) ?? null;
  useEffect(() => {
    const onChange = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  useEffect(() => {
    let stop = false;
    void fetchJson<{ house: YardHouse | null }>("/api/yard-scene")
      .then((body) => { if (!stop) setHouse(body.house ?? null); })
      .catch(() => { if (!stop) setHouse(null); });
    return () => { stop = true; };
  }, []);
  async function saveHouse(next: YardHouse | null) {
    const previous = house;
    setHouse(next);
    try {
      const body = await fetchJson<{ house: YardHouse | null }>("/api/yard-scene", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ house: next }),
      });
      setHouse(body.house ?? null);
    } catch {
      setHouse(previous);
    }
  }
  useLayoutEffect(() => {
    houseRef.current = house;
    saveHouseRef.current = saveHouse;
  });
  useEffect(() => {
    if (attachments.length === 0) return;
    let stop = false;
    const pull = () => {
      void fetchJson<{ lights: YardLiveFeed[] }>("/api/yard/live")
        .then((body) => { if (!stop) setFeed(body.lights ?? []); })
        .catch(() => { if (!stop) setFeed([]); });
    };
    const timer = setInterval(pull, 2000);
    pull();
    return () => { stop = true; clearInterval(timer); };
  }, [attachments]);
  return (
    <div className="absolute inset-0" data-yard-3d="view" data-yard-ready={ready ? "yes" : "no"} data-camera={view} data-house={house ? "yes" : "no"}>
      <Yard3dBoundary onFail={() => setReady(false)}>
        <Canvas
          className="touch-none"
          frameloop={pageVisible ? "always" : "never"}
          camera={{ fov: 45, position: [0, 1.6, 6], near: 0.05, far: 200 }}
          dpr={dpr}
          gl={{ antialias: true, alpha: false, powerPreference: "low-power" }}
          onPointerMissed={() => onPick(null)}
          onCreated={({ gl, camera }) => {
            gl.setClearColor("#07080a");
            const raycaster = new Raycaster();
            const pointer = new Vector2();
            const hit = new Vector3();
            const plane = new Plane(new Vector3(0, 1, 0), 0);
            gl.domElement.addEventListener("dblclick", (event) => {
              if (houseRef.current) return;
              const rect = gl.domElement.getBoundingClientRect();
              pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
              pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
              raycaster.setFromCamera(pointer, camera);
              if (!raycaster.ray.intersectPlane(plane, hit)) return;
              void saveHouseRef.current(defaultHouse({ x: hit.x, z: hit.z }));
            });
          }}
        >
          <color attach="background" args={["#07080a"]} />
          <PerformanceMonitor
            onDecline={() => { setDpr(1); setGlow(false); }}
            onIncline={() => setDpr(1.25)}
          />
          <Frame view={view} lights={framed} propId={picked} controlsRef={controlsRef} />
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0, 0]}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (!drag) return;
              const hit = event.ray.intersectPlane(ground, groundHit);
              if (!hit) return;
              event.stopPropagation();
              const at = dragOnGround({ point: drag.point, from: drag.from, to: { x: hit.x, z: hit.z } });
              drag.at = at;
              setDraft({ id: drag.propId, at });
            }}
            onPointerUp={() => { void finishDrag(); }}
            onDoubleClick={(event) => {
              if (house) return;
              const hit = event.ray.intersectPlane(ground, groundHit);
              if (!hit) return;
              event.stopPropagation();
              void saveHouse(defaultHouse({ x: hit.x, z: hit.z }));
            }}
          >
            <planeGeometry args={[80, 80]} />
            <meshBasicMaterial color="#101218" />
          </mesh>
          <Grid
            args={[40, 40]}
            position={[0, 0.002, 0]}
            cellSize={1}
            cellThickness={0.6}
            cellColor="#2a2d33"
            sectionSize={5}
            sectionThickness={1.1}
            sectionColor="#3a3e46"
            fadeDistance={28}
            fadeStrength={1}
            infiniteGrid
          />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
            <ringGeometry args={[0.15, 0.22, 40]} />
            <meshBasicMaterial color="#7ee0d0" />
          </mesh>
          {house ? <HouseShape house={house} /> : null}
          {glow && lights.length > 0 ? (
            <EffectComposer>
              <SelectiveBloom selection={lightMesh} intensity={1.1} luminanceThreshold={0} mipmapBlur />
            </EffectComposer>
          ) : null}
          <LightPoints
            meshRef={lightMesh}
            lights={lights}
            props={props}
            look={look}
            playing={playing}
            attachments={attachments}
            outputs={outputs}
            feed={feed}
            onPick={onPick}
            onWord={setWord}
            onGrab={(propId, from) => beginDrag(propId, from)}
            onDrop={() => { void finishDrag(); }}
            ground={ground}
            groundHit={groundHit}
          />
          <Ready onReady={() => setReady(true)} />
        </Canvas>
      </Yard3dBoundary>
      <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex flex-wrap gap-2">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={view === item.id}
            className={`pointer-events-auto min-h-11 rounded-lg border px-3 text-[15px] ${view === item.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-[#07080a]/90 text-foreground"}`}
            onClick={() => {
              if (item.id === "prop" && !picked) onPick(props[0]?.id ?? null);
              setView(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
        <select
          aria-label="Look"
          value={lookId}
          className="pointer-events-auto min-h-11 max-w-40 rounded-lg border border-border bg-[#07080a]/90 px-2 text-base text-foreground"
          onChange={(event) => {
            setLookId(event.target.value);
            setPlaying(false);
          }}
        >
          <option value="">Colours on the prop</option>
          {looks.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
        <button
          type="button"
          aria-pressed={playing}
          disabled={!look}
          className="pointer-events-auto min-h-11 rounded-lg border border-border bg-[#07080a]/90 px-3 text-[15px] disabled:opacity-50"
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? "Stop" : "Play"}
        </button>
        {picked && pickedPoint ? (
          <>
            <button type="button" className="pointer-events-auto min-h-11 rounded-lg border border-border bg-[#07080a]/90 px-3 text-[15px]" onClick={() => void onPlace(picked, turnYardPoint(pickedPoint))}>Turn</button>
            <button type="button" className="pointer-events-auto min-h-11 rounded-lg border border-border bg-[#07080a]/90 px-3 text-[15px]" onClick={() => void onPlace(picked, toggleYardMount(pickedPoint))}>{pickedPoint.mount === "flat" ? "Stand up" : "Lay flat"}</button>
          </>
        ) : null}
        {word === "preview" ? <span className="pointer-events-none self-center text-[14px] text-muted-foreground">Preview</span> : null}
        {word === "live" ? <span className="pointer-events-none self-center text-[14px] text-muted-foreground">From the controller</span> : null}
        {word === "mixed" ? <span className="pointer-events-none self-center text-[14px] text-muted-foreground">From the controller where it answered. The rest is a preview.</span> : null}
      </div>
    </div>
  );
}

function Frame({ view, lights, propId, controlsRef }: { view: YardView; lights: YardLight[]; propId: string | null; controlsRef: { current: CameraControlsImpl | null } }) {
  const pose = useMemo(() => yardCamera({ view, lights, propId }), [view, lights, propId]);
  useEffect(() => {
    const current = controlsRef.current;
    if (!current) return;
    void current.setLookAt(pose.position.x, pose.position.y, pose.position.z, pose.target.x, pose.target.y, pose.target.z, false);
  }, [pose, controlsRef]);
  return (
    <CameraControls
      ref={controlsRef}
      makeDefault
      minPolarAngle={0.05}
      maxPolarAngle={Math.PI / 2 - 0.02}
      minDistance={0.5}
      maxDistance={80}
    />
  );
}

function LightPoints({
  lights,
  props,
  look,
  playing,
  attachments,
  outputs,
  feed,
  onPick,
  onWord,
  onGrab,
  onDrop,
  ground,
  groundHit,
  meshRef,
}: {
  lights: ColoredLight[];
  props: Prop[];
  look: Look | null;
  playing: boolean;
  attachments: PropAttachment[];
  outputs: { lightId: string; outputId: string; start: number }[];
  feed: YardLiveFeed[];
  onPick: (propId: string | null) => void;
  onWord: (word: ColourWord) => void;
  onGrab: (propId: string, from: { x: number; z: number }) => void;
  onDrop: () => void;
  ground: Plane;
  groundHit: Vector3;
  meshRef: { current: InstancedMesh | null };
}) {
  const mesh = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const color = useMemo(() => new Color(), []);
  const clock = useRef(0);
  const word = useRef<ColourWord>("section");
  const lookRef = useRef(look);
  const playingRef = useRef(playing);
  const feedRef = useRef(feed);
  useLayoutEffect(() => {
    lookRef.current = look;
    playingRef.current = playing;
    feedRef.current = feed;
  }, [look, playing, feed]);
  useLayoutEffect(() => { clock.current = 0; }, [look?.id]);
  const paint = () => {
    const current = mesh.current;
    if (!current) return;
    meshRef.current = current;
    const painted = frameColours({
      props,
      lights,
      look: lookRef.current,
      t: clock.current,
      attachments,
      outputs,
      feed: feedRef.current,
    });
    lights.forEach((light, index) => {
      dummy.position.set(light.x, light.y, light.z);
      dummy.updateMatrix();
      current.setMatrixAt(index, dummy.matrix);
      current.setColorAt(index, color.set(painted.colors[index] ?? light.color));
    });
    current.instanceMatrix.needsUpdate = true;
    if (current.instanceColor) current.instanceColor.needsUpdate = true;
    if (painted.word !== word.current) {
      word.current = painted.word;
      onWord(painted.word);
    }
  };
  useFrame((_, delta) => {
    if (playingRef.current) clock.current += delta;
    paint();
  });
  if (lights.length === 0) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, lights.length]}
      onPointerDown={(event) => {
        event.stopPropagation();
        const index = event.instanceId;
        const propId = index == null ? undefined : lights[index]?.propId;
        const hit = event.ray.intersectPlane(ground, groundHit);
        if (!propId || !hit) return;
        onGrab(propId, { x: hit.x, z: hit.z });
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        onDrop();
      }}
      onClick={(event) => {
        event.stopPropagation();
        const index = event.instanceId;
        const propId = index == null ? undefined : lights[index]?.propId;
        if (propId) onPick(propId);
      }}
    >
      <sphereGeometry args={[0.04, 10, 8]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

function HouseShape({ house }: { house: YardHouse }) {
  const walls = useMemo(() => {
    const shape = new Shape();
    house.footprint.forEach((point, index) => {
      if (index === 0) shape.moveTo(point.x, -point.z);
      else shape.lineTo(point.x, -point.z);
    });
    shape.closePath();
    return new ExtrudeGeometry(shape, { depth: house.eaveM, bevelEnabled: false });
  }, [house]);
  const roof = useMemo(() => roofPositions(house), [house]);
  return (
    <group>
      <mesh geometry={walls} rotation={[-Math.PI / 2, 0, 0]}>
        <meshBasicMaterial color="#3a4150" />
        <lineSegments>
          <edgesGeometry args={[walls]} />
          <lineBasicMaterial color="#d4a574" />
        </lineSegments>
      </mesh>
      {roof ? (
        <mesh>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[roof, 3]} />
          </bufferGeometry>
          <meshBasicMaterial color="#8a6a4a" side={DoubleSide} />
        </mesh>
      ) : null}
    </group>
  );
}

function roofPositions(house: YardHouse): Float32Array | null {
  if (house.footprint.length !== 4) return null;
  const [a, b, c, d] = house.footprint;
  if (!a || !b || !c || !d) return null;
  const y = house.eaveM;
  const ridge = y + house.ridgeM;
  const left = { x: (a.x + d.x) / 2, y: ridge, z: (a.z + d.z) / 2 };
  const right = { x: (b.x + c.x) / 2, y: ridge, z: (b.z + c.z) / 2 };
  return new Float32Array([
    a.x, y, a.z, b.x, y, b.z, right.x, right.y, right.z,
    a.x, y, a.z, right.x, right.y, right.z, left.x, left.y, left.z,
    d.x, y, d.z, left.x, left.y, left.z, right.x, right.y, right.z,
    d.x, y, d.z, right.x, right.y, right.z, c.x, y, c.z,
  ]);
}

function Ready({ onReady }: { onReady: () => void }) {
  const sent = useRef(false);
  useFrame(() => {
    if (sent.current) return;
    sent.current = true;
    onReady();
  });
  return null;
}

class Yard3dBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(): void {
    this.props.onFail();
  }

  render() {
    if (this.state.failed) {
      return (
        <p className="p-4 text-[15px] leading-6 text-muted-foreground" data-yard-3d="fallback">
          This browser cannot show the 3D yard. Switch back to the drawing.
        </p>
      );
    }
    return this.props.children;
  }
}

type ColourWord = "section" | "preview" | "live" | "mixed";

function frameColours(input: {
  props: readonly Prop[];
  lights: readonly ColoredLight[];
  look: Look | null;
  t: number;
  attachments: readonly PropAttachment[];
  outputs: readonly { lightId: string; outputId: string; start: number }[];
  feed: readonly YardLiveFeed[];
}): { colors: string[]; word: ColourWord } {
  const preview = input.look ? lookFrame({ look: input.look, props: input.props, t: input.t }) : null;
  const byKey = new Map(preview?.map((row) => [`${row.propId}:${row.stringId}:${row.index}`, row.color]));
  let liveCount = 0;
  let other = 0;
  const colors = input.lights.map((light) => {
    const live = yardLiveColour({
      propId: light.propId,
      stringId: light.stringId,
      index: light.index,
      props: input.props,
      attachments: input.attachments,
      outputs: input.outputs,
      feed: input.feed,
    });
    if (live) {
      liveCount += 1;
      return live;
    }
    other += 1;
    if (preview) return byKey.get(`${light.propId}:${light.stringId}:${light.index}`) ?? "#000000";
    return light.color;
  });
  const word: ColourWord = liveCount === 0 ? (input.look ? "preview" : "section") : other === 0 ? "live" : "mixed";
  return { colors, word };
}

type ColoredLight = YardLight & { color: string };

function coloredLights(props: readonly Prop[]): ColoredLight[] {
  const byId = new Map(props.map((prop) => [prop.id, prop]));
  return yardLightPositions(props).map((light) => ({ ...light, color: colourOf(byId.get(light.propId), light.edgeId) }));
}

function colourOf(prop: Prop | undefined, edgeId: string): string {
  return prop?.sections?.find((section) => section.color && section.edgeIds.includes(edgeId))?.color ?? WARM;
}
