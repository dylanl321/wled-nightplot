import { createElement, type ReactNode } from "react";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) {
    return createElement("a", { href, ...props }, children);
  },
}));

// jsdom has no 2D canvas. Konva only needs a context that accepts calls, so
// stand in a quiet one. Hit detection then finds no shape, which reads as empty space.
if (typeof HTMLCanvasElement !== "undefined") {
  const quiet = (): CanvasRenderingContext2D => {
    const state: Record<string | symbol, unknown> = {};
    return new Proxy(state, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === "measureText") return (text: string) => ({ width: text.length * 6 });
        if (key === "getImageData") return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) });
        if (key === "createLinearGradient" || key === "createRadialGradient" || key === "createPattern") return () => ({ addColorStop() {} });
        if (key === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
        return () => undefined;
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  };
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value(this: HTMLCanvasElement, kind: string) {
      return kind === "2d" ? quiet() : null;
    },
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
