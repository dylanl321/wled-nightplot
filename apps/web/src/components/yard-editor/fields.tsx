"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

/**
 * A text box that keeps what you are typing while the rest of the panel
 * re-renders, and selects its contents on first tap so typing replaces the
 * old value (64 does not become 6460). `onCommit` runs on Enter and on
 * leaving the field.
 */
export function CommitField({
  value,
  onCommit,
  onLive,
  selectOnFocus = true,
  className = "num",
  ...rest
}: {
  value: string;
  onCommit: (text: string, alt?: boolean) => void;
  /** Called on every keystroke (names update the drawing as you type). */
  onLive?: (text: string) => void;
  selectOnFocus?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "defaultValue">) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  const fresh = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return (
    <input
      {...rest}
      className={className}
      value={text}
      onChange={(event) => {
        fresh.current = false;
        setText(event.target.value);
        onLive?.(event.target.value);
      }}
      onFocus={(event) => {
        focused.current = true;
        if (!selectOnFocus) return;
        fresh.current = true;
        const input = event.currentTarget;
        setTimeout(() => {
          try {
            input.select();
          } catch {
            /* Some input types refuse a selection. */
          }
        }, 0);
      }}
      onClick={(event) => {
        // The browser puts the caret where the finger lifted, after focus. Select again once.
        if (fresh.current) {
          fresh.current = false;
          event.currentTarget.select();
        }
      }}
      onKeyDown={(event) => {
        fresh.current = false;
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit(event.currentTarget.value, event.altKey);
        }
        if (event.key === "Escape") {
          setText(value);
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        focused.current = false;
        fresh.current = false;
        if (event.currentTarget.value !== value) onCommit(event.currentTarget.value);
      }}
    />
  );
}

/** A colour swatch and a hex box. The hex box selects on tap like a number. */
export function ColourInput({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  return (
    <span className="colorf">
      <input type="color" value={value} aria-label={label} onChange={(event) => onChange(event.target.value.toLowerCase())} />
      <CommitField
        className="hex"
        value={value.toUpperCase()}
        maxLength={7}
        aria-label={`${label} hex`}
        onCommit={(text) => {
          const hex = text.trim().startsWith("#") ? text.trim() : `#${text.trim()}`;
          if (/^#[0-9a-f]{6}$/i.test(hex)) onChange(hex.toLowerCase());
        }}
      />
    </span>
  );
}
