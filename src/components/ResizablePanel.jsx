import { useRef, useCallback, useEffect } from "react";
import { theme } from "../lib/theme.js";
import usePersistentState from "../hooks/usePersistentState.js";

/**
 * ResizablePanel - Drag handle between two panels.
 * Children are rendered in a flex container with the divider between them.
 *
 * Usage:
 *   <ResizablePanel initialSplit={0.7} minPx={200} direction="horizontal">
 *     <LeftPanel />
 *     <RightPanel />
 *   </ResizablePanel>
 */
export default function ResizablePanel({ children, initialSplit, minPx, direction, storageKey }) {
  if (!initialSplit) initialSplit = 0.7;
  if (!minPx) minPx = 120;
  if (!direction) direction = "horizontal";

  var [split, setSplit] = usePersistentState(storageKey || null, initialSplit);
  var containerRef = useRef(null);
  var dragging = useRef(false);

  var isHoriz = direction === "horizontal";

  var handleMouseDown = useCallback(function (e) {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = isHoriz ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }, [isHoriz]);

  useEffect(function () {
    function handleMouseMove(e) {
      if (!dragging.current || !containerRef.current) return;
      var rect = containerRef.current.getBoundingClientRect();
      var pos = isHoriz
        ? (e.clientX - rect.left) / rect.width
        : (e.clientY - rect.top) / rect.height;
      var minFrac = minPx / (isHoriz ? rect.width : rect.height);
      var clamped = Math.max(minFrac, Math.min(1 - minFrac, pos));
      setSplit(clamped);
    }

    function handleMouseUp() {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return function () {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  // setSplit from usePersistentState is stable (React guarantees setState identity),
  // so omitting it from deps is safe -- but we list isHoriz and minPx since those
  // affect the clamping math inside handleMouseMove.
  }, [isHoriz, minPx, setSplit]); // eslint-disable-line react-hooks/exhaustive-deps

  var kids = Array.isArray(children) ? children : [children];
  if (kids.length < 2) return kids[0] || null;

  var firstSize = (split * 100).toFixed(2) + "%";
  var secondSize = ((1 - split) * 100).toFixed(2) + "%";

  return (
    <div ref={containerRef} style={{
      display: "flex", flexDirection: isHoriz ? "row" : "column",
      width: "100%", height: "100%", minHeight: 0, minWidth: 0,
    }}>
      <div style={{
        [isHoriz ? "width" : "height"]: firstSize,
        minHeight: 0, minWidth: 0, overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        {kids[0]}
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          [isHoriz ? "width" : "height"]: 6,
          cursor: isHoriz ? "col-resize" : "row-resize",
          background: "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, position: "relative",
          zIndex: theme.z.active,
        }}
      >
        <div style={{
          [isHoriz ? "width" : "height"]: 2,
          [isHoriz ? "height" : "width"]: 24,
          background: theme.border.strong,
          borderRadius: 1,
          transition: "background " + theme.transition.fast,
        }} />
      </div>

      <div style={{
        [isHoriz ? "width" : "height"]: secondSize,
        minHeight: 0, minWidth: 0, overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        {kids[1]}
      </div>
    </div>
  );
}
