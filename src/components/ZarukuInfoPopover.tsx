"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

type Box = { left: number; top: number; width: number; height: number };
type Size = { width: number; height: number };
type Position = { left: number; top: number; placement: "above" | "below" };

export function positionZarukuInfoPopover(
  trigger: Box,
  surface: Size,
  viewport: Size,
  margin = 16,
  gap = 8,
): Position {
  const centeredLeft = trigger.left + trigger.width / 2 - surface.width / 2;
  const maxLeft = Math.max(margin, viewport.width - margin - surface.width);
  const left = Math.min(Math.max(centeredLeft, margin), maxLeft);
  const below = trigger.top + trigger.height + gap;

  return below + surface.height <= viewport.height - margin
    ? { left, top: below, placement: "below" }
    : {
        left,
        top: Math.max(margin, trigger.top - gap - surface.height),
        placement: "above",
      };
}

export default function ZarukuInfoPopover({
  label,
  children,
  triggerClassName = "",
}: {
  label: string;
  children: ReactNode;
  triggerClassName?: string;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const open = hovered || focused || pinned;

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHovered(false), 80);
  }, [cancelClose]);

  useLayoutEffect(() => {
    if (!open) return;

    const update = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const surface = surfaceRef.current?.getBoundingClientRect();
      if (!trigger || !surface) return;
      setPosition(positionZarukuInfoPopover(trigger, surface, {
        width: window.innerWidth,
        height: window.innerHeight,
      }));
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const close = () => {
      setPinned(false);
      setHovered(false);
      setFocused(false);
      triggerRef.current?.blur();
    };
    const pointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !surfaceRef.current?.contains(target)) {
        close();
      }
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("pointerdown", pointerDown);
    document.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("pointerdown", pointerDown);
      document.removeEventListener("keydown", keyDown);
    };
  }, [open]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  const surface = open && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={surfaceRef}
          id={id}
          role="tooltip"
          onPointerEnter={() => {
            cancelClose();
            setHovered(true);
          }}
          onPointerLeave={scheduleClose}
          className="fixed z-[100] w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-3 text-left text-slate-700 shadow-xl"
          style={{
            left: position?.left ?? 16,
            top: position?.top ?? 16,
            visibility: position ? "visible" : "hidden",
          }}
          data-placement={position?.placement}
        >
          {children}
        </div>,
        document.body,
      )
    : null;

  return (
    <span
      className="inline-flex shrink-0"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") {
          cancelClose();
          setHovered(true);
        }
      }}
      onPointerLeave={scheduleClose}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-describedby={open ? id : undefined}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null;
          if (!next || !surfaceRef.current?.contains(next)) setFocused(false);
        }}
        onClick={() => {
          if (pinned) {
            setPinned(false);
            setFocused(false);
            triggerRef.current?.blur();
          } else {
            setPinned(true);
          }
        }}
        className={`inline-flex size-5 items-center justify-center rounded-full text-slate-400 outline-none transition hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 ${triggerClassName}`}
      >
        <Info className="size-3.5" aria-hidden="true" />
      </button>
      {surface}
    </span>
  );
}
