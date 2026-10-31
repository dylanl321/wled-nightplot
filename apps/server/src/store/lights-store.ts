import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  attachmentForLegacy,
  enrichStoredProp,
  isProp,
  isPropAttachment,
  macsMatch,
  normalizeLightLedProductId,
  withMigratedOutputs,
  type Element,
  type Light,
  type Prop,
  type PropAttachment,
} from "@nightplot/shared";
import { isEnoent, keepLastGood, StoreUnreadableError } from "./store-error.ts";

type FileShape = {
  version: 1;
  lights: Light[];
  elements?: Element[];
  props?: Prop[];
  attachments?: PropAttachment[];
};

type StoreShape = {
  lights: Light[];
  elements: Element[];
  props: Prop[];
  attachments: PropAttachment[];
};

type ReadShape = StoreShape & { droppedElements: number; droppedProps: number; droppedAttachments: number };

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
      const attachments = parsed.attachments ?? [];
      if (parsed.version !== 1 || !this.validBackup({ lights: parsed.lights, elements, props, attachments }))
        throw new Error("Invalid Lights store; backup refused.");
      const lights = parsed.lights.map(normalizeStoredLight);
      const normalized = normalizeProps(lights, elements, props, attachments);
      return { lights, elements, props: normalized.props, attachments: normalized.attachments };
    } catch (error) {
      if (isEnoent(error)) return { lights: [], elements: [], props: [], attachments: [] };
      throw error;
    }
  }

  restoreBackup(value: StoreShape): void {
    if (!this.validBackup({ ...value, props: value.props ?? [], attachments: value.attachments ?? [] })) {
      throw new Error("Invalid backup Lights, Segments, or Props; nothing was restored.");
    }
    const normalized = normalizeProps(value.lights, value.elements, value.props ?? [], value.attachments ?? []);
    this.write(value.lights, value.elements, normalized.props, normalized.attachments);
  }

  validBackup(value: { lights: Light[]; elements: Element[]; props?: Prop[]; attachments?: PropAttachment[] }): boolean {
    const props = value.props ?? [];
    const attachments = value.attachments ?? [];
    return Array.isArray(value.lights) && value.lights.every(isStoredLight) &&
      Array.isArray(value.elements) && value.elements.every(isElement) &&
      Array.isArray(props) && props.every(isProp) &&
      Array.isArray(attachments) && attachments.every(isPropAttachment) &&
      new Set(value.lights.map((light) => light.id)).size === value.lights.length &&
      new Set(value.lights.map((light) => light.hostKey)).size === value.lights.length &&
      new Set(value.elements.map((element) => element.id)).size === value.elements.length &&
      new Set(props.map((prop) => prop.id)).size === props.length &&
      new Set(attachments.map((row) => row.propId)).size === attachments.length &&
      value.elements.every((element) => value.lights.some((light) => light.id === element.lightId)) &&
      props.every((prop) => propFits(prop, value.lights, value.elements)) &&
      attachments.every((row) =>
        props.some((prop) => prop.id === row.propId) &&
        value.lights.some((light) => light.id === row.lightId) &&
        (row.afterPropId === null || props.some((prop) => prop.id === row.afterPropId)),
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

  loadAttachments(): PropAttachment[] {
    return this.read().attachments;
  }

  elementsFor(lightId: string): Element[] {
    return this.read().elements.filter((element) => element.lightId === lightId);
  }

  propsFor(lightId: string): Prop[] {
    const { props, attachments } = this.read();
    const ids = new Set(attachments.filter((row) => row.lightId === lightId).map((row) => row.propId));
    return props.filter((prop) => prop.lightId === lightId || ids.has(prop.id));
  }

  saveDesignedProp(prop: Prop): void {
    const state = this.readForWrite();
    const rest = state.props.filter((row) => row.id !== prop.id);
    const attachments = prop.lightId
      ? state.attachments
      : state.attachments.filter((row) => row.propId !== prop.id);
    this.write(state.lights, state.elements, [...rest, prop], attachments);
  }

  attachProp(prop: Prop, attachment: PropAttachment, elements: Element[]): void {
    const state = this.readForWrite();
    const drop = new Set(state.props.find((row) => row.id === prop.id)?.elementIds ?? []);
    const nextProp: Prop = { ...prop, lightId: attachment.lightId };
    const props = [...state.props.filter((row) => row.id !== prop.id), nextProp];
    const keptElements = state.elements.filter((element) => !drop.has(element.id) && element.lightId !== attachment.lightId);
    const sameLight = elements.filter((element) => element.lightId === attachment.lightId);
    const attachments = [
      ...state.attachments.filter((row) => row.propId !== prop.id),
      attachment,
    ];
    this.write(state.lights, [...keptElements, ...sameLight], props, attachments);
  }

  findByHostKey(hostKey: string): Light | undefined {
    return this.read().lights.find((light) => light.hostKey === hostKey);
  }

  findById(id: string): Light | undefined {
    return this.read().lights.find((light) => light.id === id);
  }

  findByMac(mac: string): Light | undefined {
    return this.read().lights.find((light) => light.mac != null && macsMatch(light.mac, mac));
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
    const { lights, elements, props, attachments } = this.readForWrite();
    const kept = lights.filter((light) => light.id !== next.id && light.hostKey !== next.hostKey);
    kept.push(next);
    this.write(kept, elements, props, attachments);
  }

  replace(next: Light): void {
    const { lights, elements, props, attachments } = this.readForWrite();
    this.write(
      lights.map((light) => (light.id === next.id ? next : light)),
      elements,
      props,
      attachments,
    );
  }

  remove(id: string): boolean {
    const { lights, elements, props, attachments } = this.readForWrite();
    if (!lights.some((light) => light.id === id)) return false;
    this.write(
      lights.filter((light) => light.id !== id),
      elements.filter((element) => element.lightId !== id),
      props.map((prop) => prop.lightId === id ? { ...prop, lightId: undefined, elementIds: [] } : prop),
      attachments.filter((row) => row.lightId !== id),
    );
    return true;
  }

  replaceElements(lightId: string, next: Element[]): void {
    const { lights, elements, props, attachments } = this.readForWrite();
    const keptIds = new Set(next.map((element) => element.id));
    this.write(
      lights,
      [
        ...elements.filter((element) => element.lightId !== lightId),
        ...next,
      ],
      pruneProps(props, lightId, keptIds),
      attachments,
    );
  }

  replaceProps(lightId: string, next: Prop[]): void {
    const { lights, elements, props, attachments } = this.readForWrite();
    const incomingIds = new Set(next.map((prop) => prop.id));
    const kept = props.filter((prop) => prop.lightId !== lightId && !incomingIds.has(prop.id));
    const stored = next.map((prop) => ({ ...prop, lightId }));
    const keptAttachments = attachments.filter((row) => row.lightId !== lightId && !incomingIds.has(row.propId));
    const light = lights.find((row) => row.id === lightId);
    const incomingAttachments = stored.map((prop) => {
      const existing = attachments.find((row) => row.propId === prop.id && row.lightId === lightId);
      return existing ?? attachmentForLegacy(prop, elements, light) ?? {
        propId: prop.id,
        lightId,
        outputId: light?.outputs?.[0]?.id ?? `${lightId}:out:0`,
        startIndex: 0,
        afterPropId: null,
      };
    });
    this.write(lights, elements, [...kept, ...stored], [...keptAttachments, ...incomingAttachments]);
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
      if (isEnoent(error)) {
        return { lights: [], elements: [], props: [], attachments: [], droppedElements: 0, droppedProps: 0, droppedAttachments: 0 };
      }
      throw new StoreUnreadableError("Lights store", this.filePath, error instanceof SyntaxError ? "not JSON" : "unreadable");
    }
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.lights) ||
      (parsed.elements !== undefined && !Array.isArray(parsed.elements)) ||
      (parsed.props !== undefined && !Array.isArray(parsed.props)) ||
      (parsed.attachments !== undefined && !Array.isArray(parsed.attachments)))
      throw new StoreUnreadableError("Lights store", this.filePath, "unexpected shape or version");
    const elementRows = parsed.elements ?? [];
    const propRows = parsed.props ?? [];
    const attachmentRows = parsed.attachments ?? [];
    const elements = elementRows.filter(isElement);
    const parsedProps = propRows.filter(isProp);
    const parsedAttachments = attachmentRows.filter(isPropAttachment);
    const duplicateAttachment = new Set(parsedAttachments.map((row) => row.propId)).size !== parsedAttachments.length;
    const lights = parsed.lights.map(normalizeStoredLight);
    const normalized = normalizeProps(lights, elements, parsedProps, parsedAttachments);
    return {
      lights,
      elements,
      props: normalized.props,
      attachments: normalized.attachments,
      droppedElements: elementRows.length - elements.length,
      droppedProps: propRows.length - parsedProps.length,
      droppedAttachments: attachmentRows.length - parsedAttachments.length + (duplicateAttachment ? 1 : 0),
    };
  }

  /** Writes refuse when a read skipped rows, so a save never deletes what it could not parse. */
  private readForWrite(): StoreShape {
    const shape = this.read();
    if (shape.droppedElements > 0)
      throw new StoreUnreadableError("Lights store", this.filePath, `${shape.droppedElements} Segment rows Nightplot does not understand`);
    if (shape.droppedProps > 0)
      throw new StoreUnreadableError("Lights store", this.filePath, `${shape.droppedProps} Prop rows Nightplot does not understand`);
    if (shape.droppedAttachments > 0)
      throw new StoreUnreadableError("Lights store", this.filePath, `${shape.droppedAttachments} Prop attachment rows Nightplot does not understand`);
    return shape;
  }

  private write(lights: Light[], elements: Element[], props: Prop[], attachments: PropAttachment[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    keepLastGood(this.filePath);
    const tmp = `${this.filePath}.tmp`;
    const body: FileShape = { version: 1, lights, elements, props, attachments };
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    renameSync(tmp, this.filePath);
  }
}

function pruneProps(props: Prop[], lightId: string, keptElementIds: Set<string>): Prop[] {
  return props.map((prop) => {
    if (prop.lightId !== lightId) return prop;
    return { ...prop, elementIds: prop.elementIds.filter((id) => keptElementIds.has(id)) };
  });
}

function propFits(prop: Prop, lights: Light[], elements: Element[]): boolean {
  if (prop.lightId && !lights.some((light) => light.id === prop.lightId)) return false;
  if (prop.elementIds.length === 0) return true;
  if (!prop.lightId) return false;
  return prop.elementIds.every((elementId) =>
    elements.some((element) => element.id === elementId && element.lightId === prop.lightId),
  );
}

function normalizeProps(
  lights: Light[],
  elements: Element[],
  props: Prop[],
  attachments: PropAttachment[],
): { props: Prop[]; attachments: PropAttachment[] } {
  const nextProps: Prop[] = [];
  const nextAttachments: PropAttachment[] = [];
  for (const prop of props) {
    const light = lights.find((row) => row.id === prop.lightId);
    const enriched = enrichStoredProp(prop, elements, light);
    nextProps.push(enriched.prop);
    const listed = attachments.find((row) => row.propId === prop.id);
    if (listed) nextAttachments.push(listed);
    else if (enriched.attachment) nextAttachments.push(enriched.attachment);
  }
  return { props: nextProps, attachments: nextAttachments };
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
