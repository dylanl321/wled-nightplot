"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { useEffect, useRef, type ReactNode } from "react";

export type EditMenuTarget = { id: string; label: string };

export type EditMenuState =
  | { kind: "point"; id: string; x: number; y: number; targets: EditMenuTarget[]; deleteReason: string | null }
  | { kind: "run"; id: string; x: number; y: number; wx: number; wy: number; dark: boolean }
  | { kind: "multi"; x: number; y: number };

export type EditMenuAction =
  | { type: "delete-point"; id: string }
  | { type: "disconnect"; id: string }
  | { type: "join"; id: string; targetId: string }
  | { type: "length"; id: string }
  | { type: "lights"; id: string }
  | { type: "dark"; id: string; dark: boolean }
  | { type: "split"; id: string }
  | { type: "split-n"; id: string; parts: number }
  | { type: "delete-run"; id: string }
  | { type: "toggle-dark" }
  | { type: "delete-selection" };

/** A small menu at a canvas point. Radix handles the keyboard and the dismiss. */
export function EditMenu({ menu, onClose, onAction }: {
  menu: EditMenuState;
  onClose: () => void;
  onAction: (action: EditMenuAction) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    trigger.current?.focus();
  }, [menu]);
  const host = typeof document === "undefined" ? undefined : document.querySelector(".ye") ?? undefined;
  return (
    <Menu.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Menu.Trigger ref={trigger} className="yemenu-anchor" style={{ left: menu.x, top: menu.y }} aria-label="Edit menu" />
      <Menu.Portal container={host}>
        <Menu.Content className="yemenu" side="bottom" align="start" sideOffset={0} avoidCollisions={false}>
          {menu.kind === "point" ? (
            <>
              <Item danger disabled={menu.deleteReason != null} onSelect={() => onAction({ type: "delete-point", id: menu.id })}>Delete point</Item>
              {menu.deleteReason ? <div className="yemenu-note">{menu.deleteReason}</div> : null}
              <Item onSelect={() => onAction({ type: "disconnect", id: menu.id })}>Disconnect</Item>
              <Menu.Sub>
                <Menu.SubTrigger className="yemenu-item">Join to…</Menu.SubTrigger>
                <Menu.Portal container={host}>
                  <Menu.SubContent className="yemenu">
                    {menu.targets.length === 0 ? <div className="yemenu-note">No other point</div> : menu.targets.map((target) => (
                      <Item key={target.id} onSelect={() => onAction({ type: "join", id: menu.id, targetId: target.id })}>{target.label}</Item>
                    ))}
                  </Menu.SubContent>
                </Menu.Portal>
              </Menu.Sub>
            </>
          ) : null}
          {menu.kind === "run" ? (
            <>
              <Item onSelect={() => onAction({ type: "length", id: menu.id })}>Set length…</Item>
              <Item onSelect={() => onAction({ type: "lights", id: menu.id })}>Set lights…</Item>
              <Item onSelect={() => onAction({ type: "dark", id: menu.id, dark: !menu.dark })}>{menu.dark ? "Make lit" : "Make dark"}</Item>
              <Item onSelect={() => onAction({ type: "split", id: menu.id })}>Split here</Item>
              <Menu.Sub>
                <Menu.SubTrigger className="yemenu-item">Split into N equal</Menu.SubTrigger>
                <Menu.Portal container={host}>
                  <Menu.SubContent className="yemenu">
                    {[2, 3, 4].map((parts) => (
                      <Item key={parts} onSelect={() => onAction({ type: "split-n", id: menu.id, parts })}>{parts} equal</Item>
                    ))}
                  </Menu.SubContent>
                </Menu.Portal>
              </Menu.Sub>
              <Item danger onSelect={() => onAction({ type: "delete-run", id: menu.id })}>Delete run</Item>
            </>
          ) : null}
          {menu.kind === "multi" ? (
            <>
              <Item onSelect={() => onAction({ type: "toggle-dark" })}>Toggle dark</Item>
              <Item danger onSelect={() => onAction({ type: "delete-selection" })}>Delete</Item>
            </>
          ) : null}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Item({ children, onSelect, danger, disabled }: { children: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean }) {
  return <Menu.Item className={danger ? "yemenu-item danger" : "yemenu-item"} disabled={disabled} onSelect={onSelect}>{children}</Menu.Item>;
}
