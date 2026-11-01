"use client";

import dynamic from "next/dynamic";

/**
 * The editor stage, loaded on the client only. Konva needs a real canvas, so
 * the stage is never prerendered on the server.
 */
export const EditorStage = dynamic(() => import("./editor-stage").then((module) => module.EditorStage), { ssr: false });

export type { EditorStageHandle, EditorStageProps, StageTap } from "./editor-stage";
export * from "./camera";
