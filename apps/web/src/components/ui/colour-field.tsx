"use client";

import { useState } from "react";

const HEX = /^#?([0-9a-fA-F]{6})$/;

/** `#rrggbb` from typed text such as `ff0000` or `#FF0000`, else null. */
export function parseHex(text: string): string | null {
  const match = HEX.exec(text.trim());
  return match ? `#${match[1]!.toLowerCase()}` : null;
}

/**
 * A colour picker with a box to type a hex code beside it. Both change the
 * same value; a typed code is used once it is six hex digits.
 */
export function ColourField({
  label,
  value,
  onChange,
  disabled,
  className,
}: {
  /** Accessible name of the picker. The text box is named "<label> hex". */
  label: string;
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(value);
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setText(value);
  }
  const bad = text.trim() !== "" && parseHex(text) === null;
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <input
        type="color"
        aria-label={label}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-14 shrink-0 cursor-pointer rounded-md border border-border bg-transparent disabled:opacity-50"
      />
      <input
        aria-label={`${label} hex`}
        aria-invalid={bad ? true : undefined}
        disabled={disabled}
        value={text}
        spellCheck={false}
        autoComplete="off"
        maxLength={7}
        onChange={(event) => {
          setText(event.target.value);
          const hex = parseHex(event.target.value);
          if (hex) onChange(hex);
        }}
        onBlur={() => setText(value)}
        className={`min-h-11 w-24 rounded-md border bg-[#07080a] px-2 font-mono text-[15px] text-foreground outline-none focus:border-primary disabled:opacity-50 ${bad ? "border-red-400" : "border-input"}`}
      />
    </span>
  );
}
