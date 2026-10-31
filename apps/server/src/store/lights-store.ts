import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  isProp,
  normalizeLightLedProductId,
  withMigratedOutputs,
  type Element,
  type Light,
  type Prop,
} from "@nightplot/shared";
import { isEnoent, keepLastGood, StoreUnreadableError } from "./store-error.ts";

type FileShape = {
  version: 1;
  lights: Light[];
  elements?: Element[];
  props?: Prop[];
};

type StoreShape = {
  lights: Light[];
  elements: Element[];
  props: Prop[];
};

type ReadShape = StoreShape & { droppedElements: number; droppedProps: number };

export type LightsRawLoad =
  | { ok: true; lights: unknown[] }
  | { ok: false; error: "unreadable" | "invalid" };

export class FileLightsStore {
  constructor(private readonly filePath: string) {}

  get path(): string {
    return this.filePath;
  }

  snapshotForBackup(): StoreShape {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as FileShape;
      const elements = parsed.elements ?? [];
      const props = parsed.props ?? [];
      if (parsed.version !== 1 || !this.validBackup({ lights: parsed.lights, elements, props }))
        throw new Error("Invalid Lights store; backup refused.");
      return { lights: parsed.lights.map(normalizeStoredLight), elements, props };
    } catch (error) {
      if (isEnoent(error)) return { lights: [], elements: [], props: [] };
      throw error;
    }
  }

  restoreBackup(value: StoreShape): void {
    if (!this.validBackup({ ...value, props: value.props ?? [] })) {
      throw new Error("Invalid backup Lights, Segments, or Props; nothing was restored.");
    }
    this.write(value.lights, value.elements, value.props ?? []);
  }

  validBackup(value: { lights: Light[]; elements: Element[]; props?: Prop[] }): boolean {
    const props = value.props ?? [];
    return Array.isArray(value.lights) && value.lights.every(isStoredLight) &&
      Array.isArray(value.elements) && value.elements.every(isElement) &&
      Array.isArray(props) && props.every(isProp) &&
      new Set(value.lights.map((light) => light.id)).size === value.lights.length &&
      new Set(value.lights.map((light) => light.hostKey)).size === value.lights.length &&
      new Set(value.elements.map((element) => element.id)).size === value.elements.length &&
      new Set(props.map((prop) => prop.id)).size === props.length &&
      value.elements.every((element) => value.lights.some((light) => light.id === element.lightId)) &&
      props.every((prop) =>
        value.lights.some((light) => light.id === prop.lightId) &&
        prop.elementIds.every((elementId) =>
          value.elements.some((element) => element.id === elementId && element.lightId === prop.lightId),
        ),
      );
  }

  load(): Light[] {
    return this.read().lights;
  }

  loadElements(): Element[] {
    return this.read().elements;
  }

  loadProps(): Prop[] {
    return this.read().props;
  }

  elementsFor(lightId: string): Element[] {
    return this.read().elements.filter((element) => element.lightId === lightId);
  }

  propsFor(lightId: string): Prop[] {
    return this.read().props.filter((prop) => prop.lightId === lightId);
  }

  findByHostKey(hostKey: string): Light | undefined {
    return this.read().lights.find((light) => light.hostKey === hostKey);
  }

  findById(id: string): Light | undefined {
    return this.read().lights.find((light) => light.id === id);
  }

  /**
   * Raw Lights rows for catalog attach counts. Missing file is a known empty
   * list. Corrupt / wrong-shaped files are not empty — callers must refuse.
   */
  tryLoadRaw(): LightsRawLoad {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as FileShape;
      if (parsed.version !== 1 || !Array.isArray(parsed.lights)) {
        return { ok: false, error: "invalid" };
      }
      return { ok: true, lights: parsed.lights };
    } catch (error) {
      if (isEnoent(error)) {
        return { ok: true, lights: [] };
      }
      return { ok: false, error: "unreadable" };
    }
  }

  upsert(next: Light): void {
    const { lights, elements, props } = this.readForWrite();
    const kept = lights.filter((light) => light.id !== next.id && light.hostKey !== next.hostKey);
    kept.push(next);
    this.write(kept, elements, props);
  }

  replace(next: Light): void {
    const { lights, elements, props } = this.readForWrite();
    this.write(
      lights.map((light) => (light.id === next.id ? next : light)),
      elements,
      props,
    );
  }

  remove(id: string): boolean {
    const { lights, elements, props } = this.readForWrite();
    if (!lights.some((light) => light.id === id)) return false;
    this.write(
      lights.filter((light) => light.id !== id),
      elements.filter((element) => element.lightId !== id),
      props.filter((prop) => prop.lightId !== id),
    );
    return true;
  }

  replaceElements(lightId: string, next: Element[]): void {
    const { lights, elements, props } = this.readForWrite();
    const keptIds = new Set(next.map((element) => element.id));
    this.write(
      lights,
      [
        ...elements.filter((element) => element.lightId !== lightId),
        ...next,
      ],
      pruneProps(props, lightId, keptIds),
    );
  }

  replaceProps(lightId: string, next: Prop[]): void {
    const { lights, elements, props } = this.readForWrite();
    this.write(lights, elements, [
      ...props.filter((prop) => prop.lightId !== lightId),
      ...next,
    ]);
  }

  /**
   * A missing file is a known empty store. A corrupt or wrong-shaped file is
   * not: it throws instead of reading as no Lights.
   */
  private read(): ReadShape {
    let parsed: FileShape;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as FileShape;
    } catch (error) {
      if (isEnoent(error)) return { lights: [], elements: [], props: [], droppedElements: 0, droppedProps: 0 };
      throw new StoreUnreadableError("Lights store", this.filePath, error instanceof SyntaxError ? "not JSON" : "unreadable");
    }
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.lights) ||
      (parsed.elements !== undefined && !Array.isArray(parsed.elements)) ||
      (parsed.props !== undefined && !Array.isArray(parsed.props)))
      throw new StoreUnreadableError("Lights store", this.filePath, "unexpected shape or version");
    const elementRows = parsed.elements ?? [];
    const propRows = parsed.props ?? [];
    const elements = elementRows.filter(isElement);
    const props = propRows.filter(isProp);
    return {
      lights: parsed.lights.map(normalizeStoredLight),
      elements,
      props,
      droppedElements: elementRows.length - elements.length,
      droppedProps: propRows.length - props.length,
    };
  }

  /** Writes refuse when a read skipped rows, so a save never deletes what it could not parse. */
  private readForWrite(): StoreShape {
    const shape = this.read();
    if (shape.droppedElements > 0)
      throw new StoreUnreadableError("Lights store", this.filePath, `${shape.droppedElements} Segment rows Nightplot does not understand`);
    if (shape.droppedProps > 0)
      throw new StoreUnreadableError("Lights store", this.filePath, `${shape.droppedProps} Prop rows Nightplot does not understand`);
    return shape;
  }

  private write(lights: Light[], elements: Element[], props: Prop[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    keepLastGood(this.filePath);
    const tmp = `${this.filePath}.tmp`;
    const body: FileShape = { version: 1, lights, elements, props };
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    renameSync(tmp, this.filePath);
  }
}

function pruneProps(props: Prop[], lightId: string, keptElementIds: Set<string>): Prop[] {
  return props.flatMap((prop) => {
    if (prop.lightId !== lightId) return [prop];
    const elementIds = prop.elementIds.filter((id) => keptElementIds.has(id));
    return elementIds.length > 0 ? [{ ...prop, elementIds }] : [];
  });
}

function normalizeStoredLight(light: Light): Light {
  return withMigratedOutputs({
    ...light,
    ledProductId: normalizeLightLedProductId(light.ledProductId),
  });
}

function isElement(value: unknown): value is Element {
  if (!value || typeof value !== "object") return false;
  const row = value as Element;
  return (
    typeof row.id === "string" &&
    typeof row.lightId === "string" &&
    typeof row.label === "string" &&
    typeof row.start === "number" &&
    typeof row.stop === "number" &&
    (row.color === undefined || (typeof row.color === "object" && row.color !== null &&
      typeof row.color.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(row.color.hex) &&
      Number.isInteger(row.color.white) && row.color.white >= 0 && row.color.white <= 255)) &&
    (row.outputId === undefined || (typeof row.outputId === "string" && row.outputId.length > 0))
  );
}

function isStoredLight(value: unknown): value is Light {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Light>;
  return typeof row.id === "string" && !!row.id && typeof row.name === "string" &&
    typeof row.hostname === "string" && typeof row.port === "number" &&
    typeof row.hostKey === "string" && Number.isInteger(row.ledCount) &&
    (row.ledCount ?? 0) > 0 && (row.mac === null || typeof row.mac === "string");
}
