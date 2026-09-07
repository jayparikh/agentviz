import { useState, useEffect, useRef, useMemo } from "react";
import { theme, TRACK_TYPES, alpha } from "../lib/theme.js";
import { buildCommandPaletteIndex, searchCommandPalette } from "../lib/commandPalette.js";
import useFocusTrap from "../hooks/useFocusTrap.js";
import useReducedMotion from "../hooks/useReducedMotion.js";
import Icon from "./Icon.jsx";
import KeyboardHint from "./ui/KeyboardHint.jsx";

/**
 * CommandPalette - Cmd+K fuzzy search overlay
 * Search events, jump to turns, filter by tool, switch views.
 */
export default function CommandPalette({ events, turns, extraItems, indexOptions, placeholder, onSeek, onSetView, onNavigateZone, onAction, onClose }) {
  var [query, setQuery] = useState("");
  var [selectedIdx, setSelectedIdx] = useState(0);
  var inputRef = useRef(null);
  var panelRef = useRef(null);
  var prefersReducedMotion = useReducedMotion();

  useFocusTrap(panelRef, { active: true, initialFocusRef: inputRef, onEscape: onClose });

  var searchIndex = useMemo(function () {
    var options = Object.assign({}, indexOptions || {}, { extraItems: extraItems || [] });
    return buildCommandPaletteIndex(events, turns, options);
  }, [events, turns, extraItems, indexOptions]);

  var results = useMemo(function () {
    return searchCommandPalette(searchIndex, query);
  }, [query, searchIndex]);

  useEffect(function () { setSelectedIdx(0); }, [query, results]);

  function runItemAction(item) {
    if (!item) return;
    if (item.type === "action" && item.actionId && onAction) onAction(item.actionId);
    if (item.type === "zone" && item.zoneId && onNavigateZone) onNavigateZone(item.zoneId);
    if (item.type === "view" && item.viewId && onSetView) onSetView(item.viewId);
    if ((item.type === "turn" || item.type === "event") && item.seekTime !== undefined && onSeek) onSeek(item.seekTime, item.eventIndex);
    onClose();
  }

  function handleKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx(function (i) { return Math.min(i + 1, results.length - 1); });
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(function (i) { return Math.max(i - 1, 0); });
    }
    if (e.key === "Enter" && results[selectedIdx]) {
      runItemAction(results[selectedIdx]);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      role="presentation"
      onMouseDown={function (event) {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
      position: "fixed", inset: 0, background: alpha(theme.bg.base, 0.6),
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      paddingTop: 120, zIndex: theme.z.modal, backdropFilter: "blur(4px)",
    }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        style={{
        width: 560, background: theme.bg.surface, border: "1px solid " + theme.border.strong,
        borderRadius: theme.radius.xxl, boxShadow: theme.shadow.md,
        overflow: "hidden",
      }}>
        <h2 id="command-palette-title" style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}>
          Command palette
        </h2>
        {/* Input */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 18px", borderBottom: "1px solid " + theme.border.default,
        }}>
          <Icon name="search" size={16} style={{ color: theme.accent.primary }} />
          <input
            ref={inputRef}
            value={query}
            onChange={function (e) { setQuery(e.target.value); }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || "Search events, turns, tools..."}
            aria-label="Search command palette"
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: theme.text.primary, fontSize: theme.fontSize.md, fontFamily: theme.font.mono,
            }}
          />
          <KeyboardHint>Esc</KeyboardHint>
        </div>

        {/* Results */}
        <div tabIndex={0} aria-label="Command results" style={{ maxHeight: 360, overflowY: "auto", padding: "6px 0" }}>
          {results.length === 0 && (
            <div style={{
              padding: "20px 18px", textAlign: "center",
              color: theme.text.dim, fontSize: theme.fontSize.md,
            }}>
              No results found
            </div>
          )}
          {results.map(function (item, i) {
            var isSelected = i === selectedIdx;
            var trackInfo = item.track ? TRACK_TYPES[item.track] : null;
            var itemColor = item.color || (
              item.type === "action" ? theme.accent.primary
              : item.type === "view" ? theme.accent.primary
              : item.type === "turn" ? theme.accent.primary
              : (trackInfo ? trackInfo.color : theme.text.secondary)
            );
            if (item.isError || item.hasError) itemColor = theme.semantic.error;

            return (
              <button
                key={i}
                tabIndex={0}
                onClick={function () { runItemAction(item); }}
                onMouseEnter={function () { setSelectedIdx(i); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 18px", cursor: "pointer",
                  background: isSelected ? theme.bg.raised : "transparent",
                  transition: prefersReducedMotion ? "none" : "background " + theme.transition.fast,
                  border: "none", width: "100%", fontFamily: theme.font.mono,
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: theme.fontSize.base, color: itemColor, width: 16, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {item.iconName ? <Icon name={item.iconName} size={13} /> : (trackInfo ? <Icon name={item.track} size={13} /> : <Icon name="circle" size={10} />)}
                </span>
                <span style={{
                  flex: 1, fontSize: theme.fontSize.base, color: isSelected ? theme.text.primary : theme.text.secondary,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {item.label}
                </span>
                <span style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost, textTransform: "uppercase", letterSpacing: 1 }}>
                  {item.type}
                </span>
                {item.time !== undefined && (
                  <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim }}>
                    {item.time.toFixed(1)}s
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: "8px 18px", borderTop: "1px solid " + theme.border.default,
          display: "flex", gap: 16, fontSize: theme.fontSize.xs, color: theme.text.ghost,
          alignItems: "center", flexWrap: "wrap",
        }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <KeyboardHint>↑↓</KeyboardHint>
            <span>navigate</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <KeyboardHint>↵</KeyboardHint>
            <span>select</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <KeyboardHint>Esc</KeyboardHint>
            <span>close</span>
          </span>
        </div>
      </div>
    </div>
  );
}
