import { findLengthAssist } from "./find-length-plugin.ts";
import type { StripAssistPlugin } from "./types.ts";

const plugins: readonly StripAssistPlugin[] = [findLengthAssist];

export function listStripAssistPlugins(): readonly StripAssistPlugin[] {
  return plugins;
}

export function getStripAssistPlugin(id: string): StripAssistPlugin | undefined {
  return plugins.find((entry) => entry.id === id);
}
