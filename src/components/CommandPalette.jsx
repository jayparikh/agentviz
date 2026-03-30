import { useState, useEffect, useRef, useMemo } from "react";
import { theme, TRACK_TYPES, alpha } from "../lib/theme.js";
import { buildCommandPaletteIndex, searchCommandPalette } from "../lib/commandPalette.js";
import Icon from "./Icon.jsx";

/**
 * CommandPalette - Cmd+K fuzzy search overlay
 * Search events, jump to turns, filter by tool, switch views.
 */
export default function CommandPalette({ events, turns, onSeek, onSetView, onAction, onClose }) {
  var [query, setQuery] = useState("");
  var [selectedIdx, setSelectedIdx] = useState(0);
  var inputRef = useRef(null);

  useEffect(function () {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  var searchIndex = useMemo(function () {
    return buildCommandPaletteIndex(events, turns);
  }, [events, turns]);

  var results = useMemo(function () {
    return searchCommandPalette(searchIndex, query);
  }, [query, searchIndex]);

  useEffect(function () { setSelectedIdx(0); }, [query, results]);

  function runItemAction(item) {
    if (!item) return;
    if (item.type === "action" && item.actionId && onAction) onAction(item.actionId);
    if (item.type === "view" && item.viewId) onSetView(item.viewId);
    if ((item.type === "turn" || item.type === "event") && item.seekTime !== undefined) onSeek(item.seekTime);
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
      onClose();
    }
  }

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: alpha(theme.bg.base, 0.6),
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      paddingTop: 120, zIndex: theme.z.modal, backdropFilter: "blur(4px)",
    }}>
      <div onClick={function (e) { e.stopPropagation(); }} style={{
        width: 560, background: theme.bg.surface, border: "1px solid " + theme.border.strong,
        borderRadius: theme.radius.xxl, boxShadow: theme.shadow.md,
        overflow: "hidden",
      }}>
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
            placeholder="Search events, turns, tools..."
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: theme.text.primary, fontSize: theme.fontSize.md, fontFamily: theme.font.mono,
            }}
          />
          <span style={{
            fontSize: theme.fontSize.xs, color: theme.text.ghost,
            background: theme.bg.raised, padding: "2px 6px", borderRadius: theme.radius.sm,
          }}>
            ESC
          </span>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 360, overflowY: "auto", padding: "6px 0" }}>
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
              <div
                key={i}
                role="button"
                tabIndex={0}
                onClick={function () { runItemAction(item); }}
                onMouseEnter={function () { setSelectedIdx(i); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 18px", cursor: "pointer",
                  background: isSelected ? theme.bg.raised : "transparent",
                  transition: "background " + theme.transition.fast,
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
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: "8px 18px", borderTop: "1px solid " + theme.border.default,
          display: "flex", gap: 16, fontSize: theme.fontSize.xs, color: theme.text.ghost,
        }}>
          <span><Icon name="arrow-up-down" size={11} /> navigate</span>
          <span><Icon name="enter" size={11} /> select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
