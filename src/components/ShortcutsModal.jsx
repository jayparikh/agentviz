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
  { key: "4", label: "Stats view" },
  { key: "e / E", label: "Jump to next / prev error" },
  { section: "Search" },
  { key: "/", label: "Focus search" },
  { key: "\u2318K", label: "Open command palette" },
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
        background: alpha(theme.bg, 0.75),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9000,
      }}
    >
      <div
        onClick={function (e) { e.stopPropagation(); }}
        style={{
          background: theme.surface,
          border: "1px solid " + theme.border,
          borderRadius: 10,
          padding: "24px 28px",
          minWidth: 320,
          maxWidth: 420,
          boxShadow: "0 8px 32px " + alpha(theme.bg, 0.8),
        }}
      >
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}>
          <span style={{ color: theme.text, fontSize: 14, fontWeight: 600, letterSpacing: "0.05em" }}>
            KEYBOARD SHORTCUTS
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: theme.textMuted,
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: "0 2px",
            }}
          >
            \u00d7
          </button>
        </div>

        {SHORTCUTS.map(function (item, i) {
          if (item.section) {
            return (
              <div key={i} style={{
                color: theme.textMuted,
                fontSize: 10,
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
              padding: "5px 0",
              borderBottom: "1px solid " + alpha(theme.border, 0.4),
            }}>
              <span style={{ color: theme.textMuted, fontSize: 12 }}>{item.label}</span>
              <kbd style={{
                background: alpha(theme.border, 0.5),
                border: "1px solid " + theme.border,
                borderRadius: 4,
                color: theme.text,
                fontSize: 11,
                fontFamily: "inherit",
                padding: "2px 7px",
                whiteSpace: "nowrap",
              }}>
                {item.key}
              </kbd>
            </div>
          );
        })}

        <div style={{ marginTop: 16, textAlign: "center" }}>
          <span style={{ color: alpha(theme.textMuted, 0.6), fontSize: 11 }}>
            Press <kbd style={{ background: alpha(theme.border, 0.5), border: "1px solid " + theme.border, borderRadius: 3, color: theme.text, fontSize: 10, padding: "1px 5px" }}>Esc</kbd> or <kbd style={{ background: alpha(theme.border, 0.5), border: "1px solid " + theme.border, borderRadius: 3, color: theme.text, fontSize: 10, padding: "1px 5px" }}>?</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
