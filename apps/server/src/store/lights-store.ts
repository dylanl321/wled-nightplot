import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeLightLedProductId, type Element, type Light } from "@nightplot/shared";

type FileShape = {
  version: 1;
  lights: Light[];
  elements?: Element[];
};

type StoreShape = {
  lights: Light[];
  elements: Element[];
};

export class FileLightsStore {
  constructor(private readonly filePath: string) {}

  load(): Light[] {
    return this.read().lights;
  }

  loadElements(): Element[] {
    return this.read().elements;
  }

  elementsFor(lightId: string): Element[] {
    return this.read().elements.filter((element) => element.lightId === lightId);
  }

  findByHostKey(hostKey: string): Light | undefined {
    return this.read().lights.find((light) => light.hostKey === hostKey);
  }

  findById(id: string): Light | undefined {
    return this.read().lights.find((light) => light.id === id);
  }

  upsert(next: Light): void {
    const { lights, elements } = this.read();
    const kept = lights.filter((light) => light.id !== next.id && light.hostKey !== next.hostKey);
    kept.push(next);
    this.write(kept, elements);
  }

  replace(next: Light): void {
    const { lights, elements } = this.read();
    this.write(
      lights.map((light) => (light.id === next.id ? next : light)),
      elements,
    );
  }

  remove(id: string): boolean {
    const { lights, elements } = this.read();
    if (!lights.some((light) => light.id === id)) return false;
    this.write(
      lights.filter((light) => light.id !== id),
      elements.filter((element) => element.lightId !== id),
    );
    return true;
  }

  replaceElements(lightId: string, next: Element[]): void {
    const { lights, elements } = this.read();
    this.write(lights, [
      ...elements.filter((element) => element.lightId !== lightId),
      ...next,
    ]);
  }

  private read(): StoreShape {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as FileShape;
      if (parsed.version !== 1 || !Array.isArray(parsed.lights)) {
        return { lights: [], elements: [] };
      }
      return {
        lights: parsed.lights.map(withLedProductId),
        elements: Array.isArray(parsed.elements)
          ? parsed.elements.filter(isElement)
          : [],
      };
    } catch {
      return { lights: [], elements: [] };
    }
  }

  private write(lights: Light[], elements: Element[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const body: FileShape = { version: 1, lights, elements };
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    renameSync(tmp, this.filePath);
  }
}

function withLedProductId(light: Light): Light {
  return {
    ...light,
    ledProductId: normalizeLightLedProductId(light.ledProductId),
  };
}

function isElement(value: unknown): value is Element {
  if (!value || typeof value !== "object") return false;
  const row = value as Element;
  return (
    typeof row.id === "string" &&
    typeof row.lightId === "string" &&
    typeof row.label === "string" &&
    typeof row.start === "number" &&
    typeof row.stop === "number"
  );
}
