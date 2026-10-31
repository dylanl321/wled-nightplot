import type { PropKind } from "@nightplot/shared";

/** Static shape pictures. Not a drawing surface. */
export function PropShapeArt({ kind }: { kind: PropKind }) {
  return (
    <svg viewBox="0 0 80 48" className="h-12 w-20 max-w-full text-primary" aria-hidden>
      <Shape kind={kind} />
    </svg>
  );
}

function Shape({ kind }: { kind: PropKind }) {
  switch (kind) {
    case "roofline":
      return <path d="M6 36 L28 14 L52 32 L74 12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />;
    case "window":
      return <rect x="18" y="8" width="44" height="32" fill="none" stroke="currentColor" strokeWidth="3" />;
    case "arch":
      return <path d="M10 40 Q40 4 70 40" fill="none" stroke="currentColor" strokeWidth="3" />;
    case "tree":
      return <path d="M40 6 L14 42 H66 Z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />;
    case "stake-row":
      return (
        <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M14 40 V16" />
          <path d="M32 40 V16" />
          <path d="M50 40 V16" />
          <path d="M68 40 V16" />
        </g>
      );
    case "wireframe":
      return (
        <g fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="8" y="10" width="20" height="28" />
          <rect x="30" y="10" width="20" height="28" />
          <rect x="52" y="10" width="20" height="28" />
          <path d="M8 10 L28 38 M8 38 L28 10" />
        </g>
      );
    case "custom":
      return <path d="M8 36 C20 8 36 40 48 16 S70 12 74 28" fill="none" stroke="currentColor" strokeWidth="3" />;
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}
