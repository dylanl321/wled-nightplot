"use client";

import dynamic from "next/dynamic";
import type { Look, Prop, PropAttachment, PropYardPoint } from "@nightplot/shared";
import { canShowYard3d } from "./webgl";

const Yard3dCanvas = dynamic(() => import("./view").then((module) => module.Yard3dCanvas), { ssr: false });

export function Yard3d({
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
  if (!canShowYard3d()) {
    return (
      <p className="p-4 text-[15px] leading-6 text-muted-foreground" data-yard-3d="fallback">
        This browser cannot show the 3D yard. Switch back to the drawing.
      </p>
    );
  }
  return <Yard3dCanvas props={props} picked={picked} onPick={onPick} looks={looks} attachments={attachments} outputs={outputs} onPlace={onPlace} />;
}
