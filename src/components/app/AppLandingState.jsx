import { useState, useEffect, useRef } from "react";
import { theme, alpha } from "../../lib/theme.js";
import FileUploader from "../FileUploader.jsx";
import Icon from "../Icon.jsx";
import InboxView from "../InboxView.jsx";
import BrandWordmark from "../ui/BrandWordmark.jsx";
import ShellFrame from "../ui/ShellFrame.jsx";

// Full-page drag overlay. Attaches listeners to document so it detects drags
// even when the overlay div itself has pointerEvents:none.
function DragOverlay({ onLoad }) {
  var [active, setActive] = useState(false);
  // Track enter/leave with a counter so nested element transitions don't flicker.
  var enterCount = useRef(0);

  var stableOnLoad = useRef(onLoad);
  stableOnLoad.current = onLoad;

  useEffect(function () {
    function onDragEnter(e) {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
      enterCount.current += 1;
      setActive(true);
    }
    function onDragLeave() {
      enterCount.current = Math.max(0, enterCount.current - 1);
      if (enterCount.current === 0) setActive(false);
    }
    function onDragOver(e) { e.preventDefault(); }
    function onDrop(e) {
      e.preventDefault();
      enterCount.current = 0;
      setActive(false);
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) { stableOnLoad.current(ev.target.result, file.name); };
      reader.readAsText(file);
    }
    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return function () {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: active ? theme.z.overlay : -1,
        pointerEvents: active ? "all" : "none",
      }}
    >
      {active && (
        <div style={{
          position: "fixed", inset: 0,
          background: alpha(theme.bg.base, 0.92),
          border: "2px dashed " + theme.accent.primary,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
          zIndex: theme.z.overlay,
        }}>
          <Icon name="upload" size={32} style={{ color: theme.accent.primary }} />
          <div style={{ fontSize: theme.fontSize.xl, color: theme.accent.primary, fontFamily: theme.font.ui }}>
            Drop session file to import
          </div>
        <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
          Claude Code and Copilot CLI .jsonl sessions
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppLandingState({ error, onLoad, onLoadSample, onStartCompare, inboxEntries, onOpenInboxSession }) {
  var hasSessions = (inboxEntries || []).length > 0;

  return (
    <ShellFrame
      style={{
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        position: "relative",
        padding: "28px 24px",
      }}
    >
      <DragOverlay onLoad={onLoad} />

      <div style={{ textAlign: "center" }}>
        <BrandWordmark style={{ fontSize: theme.fontSize.hero }} />
        <div style={{ fontSize: theme.fontSize.md, color: theme.text.dim, marginTop: 6, lineHeight: 1.6 }}>
          Visualize and improve your AI coding sessions.
        </div>
      </div>

      {hasSessions ? (
        <div style={{ width: "100%", maxWidth: 860, flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <InboxView entries={inboxEntries} onOpenSession={onOpenInboxSession} onImport={onLoad} />
        </div>
      ) : (
        <div style={{ width: "100%", maxWidth: 560 }}>
          <FileUploader onLoad={onLoad} />
        </div>
      )}

      {error && (
        <div style={{
          background: theme.semantic.errorBg,
          border: "1px solid " + theme.semantic.error,
          borderRadius: theme.radius.xl,
          padding: "12px 16px",
          fontSize: theme.fontSize.md,
          color: theme.semantic.errorText,
          maxWidth: 500,
        }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <button
          type="button"
          onClick={onLoadSample}
          style={{
            color: theme.accent.primary,
            cursor: "pointer",
            fontSize: theme.fontSize.sm,
            fontFamily: theme.font.ui,
            background: "none",
            border: "none",
            padding: 0,
          }}
        >
          load a demo session
        </button>
        <span style={{ color: theme.text.ghost, fontSize: theme.fontSize.sm }}>or</span>
        <button
          type="button"
          onClick={onStartCompare}
          style={{
            color: theme.accent.primary,
            cursor: "pointer",
            fontSize: theme.fontSize.sm,
            fontFamily: theme.font.ui,
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "none",
            border: "none",
            padding: 0,
          }}
        >
          <Icon name="arrow-up-down" size={12} /> compare two sessions
        </button>
      </div>
    </ShellFrame>
  );
}
