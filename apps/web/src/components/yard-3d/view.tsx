"use client";

import { lookFrame, yardCamera, yardLightPositions, yardLiveColour, type Look, type Prop, type PropAttachment, type YardLight, type YardLiveFeed, type YardView } from "@nightplot/shared";
import { fetchJson } from "@/lib/api";
import { CameraControls, Grid, type CameraControls as CameraControlsImpl } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Color, Object3D, type InstancedMesh } from "three";

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
}: {
  props: Prop[];
  picked: string | null;
  onPick: (propId: string | null) => void;
  looks: Look[];
  attachments: PropAttachment[];
  outputs: { lightId: string; outputId: string; start: number }[];
}) {
  const [view, setView] = useState<YardView>("street");
  const [ready, setReady] = useState(false);
  const [lookId, setLookId] = useState("");
  const [playing, setPlaying] = useState(false);
  const [feed, setFeed] = useState<YardLiveFeed[]>([]);
  const [word, setWord] = useState<ColourWord>("section");
  const lights = useMemo(() => coloredLights(props), [props]);
  const look = looks.find((row) => row.id === lookId) ?? null;
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
    <div className="absolute inset-0" data-yard-3d="view" data-yard-ready={ready ? "yes" : "no"} data-camera={view}>
      <Yard3dBoundary onFail={() => setReady(false)}>
        <Canvas
          className="touch-none"
          camera={{ fov: 45, position: [0, 1.6, 6], near: 0.05, far: 200 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: false, powerPreference: "low-power" }}
          onPointerMissed={() => onPick(null)}
          onCreated={({ gl }) => gl.setClearColor("#07080a")}
        >
          <color attach="background" args={["#07080a"]} />
          <Frame view={view} lights={lights} propId={picked} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
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
          <LightPoints
            lights={lights}
            props={props}
            look={look}
            playing={playing}
            attachments={attachments}
            outputs={outputs}
            feed={feed}
            onPick={onPick}
            onWord={setWord}
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
        {word === "preview" ? <span className="pointer-events-none self-center text-[14px] text-muted-foreground">Preview</span> : null}
        {word === "live" ? <span className="pointer-events-none self-center text-[14px] text-muted-foreground">From the controller</span> : null}
        {word === "mixed" ? <span className="pointer-events-none self-center text-[14px] text-muted-foreground">From the controller where it answered. The rest is a preview.</span> : null}
      </div>
    </div>
  );
}

function Frame({ view, lights, propId }: { view: YardView; lights: YardLight[]; propId: string | null }) {
  const controls = useRef<CameraControlsImpl>(null);
  const pose = useMemo(() => yardCamera({ view, lights, propId }), [view, lights, propId]);
  useEffect(() => {
    const current = controls.current;
    if (!current) return;
    void current.setLookAt(pose.position.x, pose.position.y, pose.position.z, pose.target.x, pose.target.y, pose.target.z, false);
  }, [pose]);
  return (
    <CameraControls
      ref={controls}
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
