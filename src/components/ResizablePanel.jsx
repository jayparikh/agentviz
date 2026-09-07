import { useRef, useEffect, useState, useId } from "react";
import { theme } from "../lib/theme.js";
import usePersistentState from "../hooks/usePersistentState.js";

export function clampPanelSplit(value, size, minPx) {
  const minimum = Math.min(0.5, minPx / Math.max(1, size - 10));
  return Math.max(minimum, Math.min(1 - minimum, Number.isFinite(value) ? value : 0.7));
}

export default function ResizablePanel({ children, initialSplit = 0.7, minPx = 120, direction = "horizontal", storageKey }) {
  const [split, setSplit] = usePersistentState(storageKey || null, initialSplit);
  const [size, setSize] = useState(0);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef(null);
  const dragging = useRef(null);
  const id = useId();
  const horizontal = direction === "horizontal";
  const actual = size ? clampPanelSplit(split, size, minPx) : split;
  const minimum = size ? Math.min(50, minPx / Math.max(1, size - 10) * 100) : 0;
  function finish() {
    if (!dragging.current) return;
    document.body.style.cursor = dragging.current.cursor;
    document.body.style.userSelect = dragging.current.userSelect;
    dragging.current = null;
  }
  useEffect(() => {
    const node = containerRef.current;
    function measure() { setSize(horizontal ? node.clientWidth : node.clientHeight); }
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(node);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); finish(); };
  }, [horizontal]);
  const kids = Array.isArray(children) ? children : [children];
  if (kids.length < 2) return kids[0] || null;
  const pane = { minHeight: 0, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" };
  return <div ref={containerRef} data-panel-direction={direction} style={{
    display: "flex", flexDirection: horizontal ? "row" : "column", width: "100%", height: "100%", minHeight: 0, minWidth: 0,
  }}>
    <div id={id} style={{ ...pane, flex: actual + " 1 0" }}>{kids[0]}</div>
    <div role="separator" aria-label="Resize evidence and inspector panels" aria-controls={id}
      aria-orientation={horizontal ? "vertical" : "horizontal"} tabIndex={0}
      aria-valuemin={Math.round(minimum)} aria-valuemax={Math.round(100 - minimum)} aria-valuenow={Math.round(actual * 100)}
      aria-valuetext={Math.round(actual * 100) + "% evidence"}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragging.current = { pointerId: event.pointerId, cursor: document.body.style.cursor, userSelect: document.body.style.userSelect };
        document.body.style.cursor = horizontal ? "col-resize" : "row-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={event => {
        if (dragging.current?.pointerId !== event.pointerId) return;
        const rect = containerRef.current.getBoundingClientRect();
        const length = horizontal ? rect.width : rect.height;
        const offset = horizontal ? event.clientX - rect.left : event.clientY - rect.top;
        setSplit(clampPanelSplit(offset / length, length, minPx));
      }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      onKeyDown={event => {
        const decrease = horizontal ? "ArrowLeft" : "ArrowUp";
        const increase = horizontal ? "ArrowRight" : "ArrowDown";
        if (![decrease, increase, "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const value = event.key === "Home" ? 0 : event.key === "End" ? 1 : actual + (event.key === decrease ? -1 : 1) * (event.shiftKey ? 0.1 : 0.02);
        setSplit(clampPanelSplit(value, size, minPx));
      }}
      style={{ [horizontal ? "width" : "height"]: 10, cursor: horizontal ? "col-resize" : "row-resize",
        touchAction: "none", background: focused ? theme.accent.muted : "transparent",
        outline: focused ? "2px solid " + theme.accent.primary : "none", outlineOffset: -2,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative", zIndex: theme.z.active }}>
      <div style={{ [horizontal ? "width" : "height"]: 2, [horizontal ? "height" : "width"]: 24,
        background: focused ? theme.accent.primary : theme.border.strong, borderRadius: theme.radius.sm }} />
    </div>
    <div style={{ ...pane, flex: (1 - actual) + " 1 0" }}>{kids[1]}</div>
  </div>;
}
