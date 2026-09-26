import type { ControllerDescriptor } from "./types.ts";
import { wledController } from "./wled.ts";

const controllers: readonly ControllerDescriptor[] = [wledController];

export function listControllers(): readonly ControllerDescriptor[] {
  return controllers;
}

export function getController(id: string): ControllerDescriptor | undefined {
  return controllers.find((entry) => entry.id === id);
}
