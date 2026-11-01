/** True when this browser can paint a WebGL yard. No GPU means the drawing stays in 2D. */
export function canShowYard3d(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
