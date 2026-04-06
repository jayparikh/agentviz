import { useState, useEffect, useRef } from "react";
import { theme, alpha } from "../../lib/theme.js";
import InboxView from "../InboxView.jsx";
import DashboardView from "../DashboardView.jsx";
import Icon from "../Icon.jsx";
import BrandWordmark from "../ui/BrandWordmark.jsx";
import ShellFrame from "../ui/ShellFrame.jsx";
import usePersistentState from "../../hooks/usePersistentState.js";

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
          <div style={{ fontSize: theme.fontSize.xl, color: theme.accent.primary, fontFamily: theme.font.mono }}>
            Drop session file to import
          </div>
          <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
            Claude Code, VS Code, and Copilot CLI sessions
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppLandingState({ error, onLoad, onLoadSample, onStartCompare, inboxEntries, onOpenInboxSession, onRefresh, manifestError, isManifestMode }) {
  var [landingMode, setLandingMode] = usePersistentState("agentviz:landing-mode", "inbox");

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

      <div style={{ width: "100%", maxWidth: landingMode === "dashboard" ? 1240 : 860, flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", gap: 8 }}>
        {/* view toggle */}
        <div style={{ display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 4, background: theme.bg.surface, border: "1px solid " + theme.border.default, borderRadius: theme.radius.lg, padding: 4 }}>
            {[
              { id: "inbox", icon: "layout-list", label: "List" },
              { id: "dashboard", icon: "layout-grid", label: "Dashboard" },
            ].map(function (item) {
              var active = landingMode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="av-btn"
                  title={item.label}
                  aria-pressed={active}
                  onClick={function () { setLandingMode(item.id); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    background: active ? theme.bg.raised : "transparent",
                    border: "none",
                    borderRadius: theme.radius.md,
                    padding: "4px 8px",
                    color: active ? theme.accent.primary : theme.text.muted,
                    fontSize: theme.fontSize.xs,
                    fontFamily: theme.font.mono,
                    whiteSpace: "nowrap",
                  }}
                >
                  <Icon name={item.icon} size={12} />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {landingMode === "dashboard" ? (
          <DashboardView
            entries={inboxEntries}
            onOpenSession={onOpenInboxSession}
            onRefresh={onRefresh}
          />
        ) : (
          <InboxView
            entries={inboxEntries}
            onOpenSession={onOpenInboxSession}
            onImport={onLoad}
            onLoadSample={onLoadSample}
            onStartCompare={onStartCompare}
            onRefresh={onRefresh}
            manifestError={manifestError}
            isManifestMode={isManifestMode}
          />
        )}
      </div>

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

    </ShellFrame>
  );
}
