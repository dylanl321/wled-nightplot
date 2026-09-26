import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Light } from "@nightplot/shared";

type FileShape = {
  version: 1;
  lights: Light[];
};

export class FileLightsStore {
  constructor(private readonly filePath: string) {}

  load(): Light[] {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as FileShape;
      if (parsed.version !== 1 || !Array.isArray(parsed.lights)) return [];
      return parsed.lights;
    } catch {
      return [];
    }
  }

  save(lights: Light[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const body: FileShape = { version: 1, lights };
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    renameSync(tmp, this.filePath);
  }

  findByHostKey(hostKey: string): Light | undefined {
    return this.load().find((light) => light.hostKey === hostKey);
  }

  upsert(next: Light): void {
    const lights = this.load().filter((light) => light.id !== next.id && light.hostKey !== next.hostKey);
    lights.push(next);
    this.save(lights);
  }

  replace(next: Light): void {
    const lights = this.load().map((light) => (light.id === next.id ? next : light));
    this.save(lights);
  }
}
