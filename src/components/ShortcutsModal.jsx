import { useRef } from "react";
import useFocusTrap from "../hooks/useFocusTrap.js";
import { theme, alpha } from "../lib/theme.js";
import KeyboardHint from "./ui/KeyboardHint.jsx";

var SHORTCUTS = [
  { section: "Playback" },
  { key: "Space", label: "Play / Pause" },
  { key: "\u2192", label: "Seek forward 2s" },
  { key: "\u2190", label: "Seek back 2s" },
  { section: "Navigation" },
  { key: "1", label: "Find" },
  { key: "2", label: "Review" },
  { key: "3", label: "Investigate" },
  { key: "4", label: "Analyze" },
  { key: "5", label: "Compare" },
  { key: "6 / 7", label: "Improve" },
  { key: "e / E", label: "Jump to next / prev error" },
  { section: "Search" },
  { key: "/", label: "Focus search" },
  { key: "Cmd/Ctrl+K", label: "Command palette" },
  { key: "Cmd/Ctrl+Shift+K", label: "Session Q&A" },
  { section: "Help" },
  { key: "?", label: "Open this dialog" },
];

export default function ShortcutsModal({ onClose }) {
  var panelRef = useRef(null);
  useFocusTrap(panelRef, { active: true, onEscape: onClose });

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: alpha(theme.bg.base, 0.75),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: theme.z.modal,
      }}
    >
      <div
        onClick={function (e) { e.stopPropagation(); }}
        style={{
          background: theme.bg.surface,
          border: "1px solid " + theme.border.default,
          borderRadius: theme.radius.xl,
          padding: theme.space.xxl + "px 28px",
          width: "calc(100% - 32px)",
          maxWidth: 420,
          maxHeight: "85vh",
          overflowY: "auto",
          boxSizing: "border-box",
          boxShadow: theme.shadow.lg,
        }}
      >
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}>
          <span style={{ color: theme.text.primary, fontSize: theme.fontSize.lg, fontWeight: 600, letterSpacing: "0.05em" }}>
            KEYBOARD SHORTCUTS
          </span>
          <button
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            style={{
              background: "none",
              border: "none",
              color: theme.text.muted,
              cursor: "pointer",
              fontSize: theme.fontSize.xl,
              lineHeight: 1,
              padding: "0 2px",
            }}
          >
            {"\u00d7"}
          </button>
        </div>

        {SHORTCUTS.map(function (item, i) {
          if (item.section) {
            return (
              <div key={i} style={{
                color: theme.text.muted,
                fontSize: theme.fontSize.xs,
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginTop: i === 0 ? 0 : 16,
                marginBottom: 6,
              }}>
                {item.section}
              </div>
            );
          }
          return (
            <div key={i} style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "4px 0",
              borderBottom: "1px solid " + alpha(theme.border.default, 0.4),
            }}>
              <span style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>{item.label}</span>
              <KeyboardHint style={{ whiteSpace: "nowrap" }}>
                {item.key}
              </KeyboardHint>
            </div>
          );
        })}

        <div style={{ marginTop: 16, textAlign: "center" }}>
          <span style={{ color: theme.text.muted, fontSize: theme.fontSize.sm }}>
            Playback: Investigate and Analyze. <KeyboardHint>Esc</KeyboardHint> closes.
          </span>
        </div>
      </div>
    </div>
  );
}
