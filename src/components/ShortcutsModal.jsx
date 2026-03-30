import { useEffect } from "react";
import { theme, alpha } from "../lib/theme.js";

var SHORTCUTS = [
  { section: "Playback" },
  { key: "Space", label: "Play / Pause" },
  { key: "\u2192", label: "Seek forward 2s" },
  { key: "\u2190", label: "Seek back 2s" },
  { section: "Navigation" },
  { key: "1", label: "Replay view" },
  { key: "2", label: "Tracks view" },
  { key: "3", label: "Waterfall view" },
  { key: "4", label: "Graph view" },
  { key: "5", label: "Stats view" },
  { key: "6", label: "Coach view" },
  { key: "e / E", label: "Jump to next / prev error" },
  { section: "Search" },
  { key: "/", label: "Focus search" },
  { key: "\u2318K", label: "Open command palette" },
  { key: "\u2318\u21e7K", label: "Session Q&A (experimental)" },
  { section: "Help" },
  { key: "?", label: "Toggle this dialog" },
];

export default function ShortcutsModal({ onClose }) {
  useEffect(function () {
    function handler(e) {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handler);
    return function () { window.removeEventListener("keydown", handler); };
  }, [onClose]);

  return (
    <div
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
          minWidth: 320,
          maxWidth: 420,
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
              <kbd style={{
                background: alpha(theme.border.default, 0.5),
                border: "1px solid " + theme.border.default,
                borderRadius: theme.radius.sm,
                color: theme.text.primary,
                fontSize: theme.fontSize.sm,
                fontFamily: "inherit",
                padding: "2px 8px",
                whiteSpace: "nowrap",
              }}>
                {item.key}
              </kbd>
            </div>
          );
        })}

        <div style={{ marginTop: 16, textAlign: "center" }}>
          <span style={{ color: alpha(theme.text.muted, 0.6), fontSize: theme.fontSize.sm }}>
            Press <kbd style={{ background: alpha(theme.border.default, 0.5), border: "1px solid " + theme.border.default, borderRadius: theme.radius.sm, color: theme.text.primary, fontSize: theme.fontSize.xs, padding: "2px 8px" }}>Esc</kbd> or <kbd style={{ background: alpha(theme.border.default, 0.5), border: "1px solid " + theme.border.default, borderRadius: theme.radius.sm, color: theme.text.primary, fontSize: theme.fontSize.xs, padding: "2px 8px" }}>?</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
