import { useState, useEffect, useRef, useMemo } from "react";
import { theme, TRACK_TYPES, alpha } from "../lib/theme.js";

/**
 * CommandPalette - Cmd+K fuzzy search overlay
 * Search events, jump to turns, filter by tool, switch views.
 */
export default function CommandPalette({ events, turns, onSeek, onSetView, onClose }) {
  var [query, setQuery] = useState("");
  var [selectedIdx, setSelectedIdx] = useState(0);
  var inputRef = useRef(null);

  useEffect(function () {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  var results = useMemo(function () {
    if (!query.trim()) {
      // Show default options: views + turns
      var defaults = [
        { type: "view", label: "Replay View", icon: "\u25B6", action: function () { onSetView("replay"); } },
        { type: "view", label: "Tracks View", icon: "\u2261", action: function () { onSetView("tracks"); } },
        { type: "view", label: "Stats View", icon: "\u25FB", action: function () { onSetView("stats"); } },
      ];
      if (turns) {
        for (var i = 0; i < Math.min(turns.length, 8); i++) {
          (function (turn) {
            defaults.push({
              type: "turn", label: "Turn " + (turn.index + 1) + ": " + (turn.userMessage || "").substring(0, 60),
              icon: "\u25CE", action: function () { onSeek(turn.startTime); },
              hasError: turn.hasError,
            });
          })(turns[i]);
        }
      }
      return defaults;
    }

    var q = query.toLowerCase();
    var items = [];

    // Search turns
    if (turns) {
      for (var i = 0; i < turns.length; i++) {
        var turn = turns[i];
        if (turn.userMessage && turn.userMessage.toLowerCase().includes(q)) {
          (function (t) {
            items.push({
              type: "turn", label: "Turn " + (t.index + 1) + ": " + t.userMessage.substring(0, 60),
              icon: "\u25CE", action: function () { onSeek(t.startTime); },
              hasError: t.hasError,
            });
          })(turn);
        }
      }
    }

    // Search events
    if (events) {
      var seen = {};
      for (var i = 0; i < events.length && items.length < 20; i++) {
        var ev = events[i];
        var hit = (ev.text && ev.text.toLowerCase().includes(q))
          || (ev.toolName && ev.toolName.toLowerCase().includes(q));
        if (hit) {
          var key = ev.t + ":" + ev.track;
          if (!seen[key]) {
            seen[key] = true;
            (function (e) {
              var info = TRACK_TYPES[e.track];
              items.push({
                type: "event",
                label: (e.toolName || e.text.substring(0, 60)),
                icon: info ? info.icon : "\u25CF",
                color: info ? info.color : theme.text.muted,
                action: function () { onSeek(e.t); },
                time: e.t,
                isError: e.isError,
              });
            })(ev);
          }
        }
      }
    }

    // View switching
    var views = [
      { id: "replay", label: "Replay View", icon: "\u25B6" },
      { id: "tracks", label: "Tracks View", icon: "\u2261" },
      { id: "stats", label: "Stats View", icon: "\u25FB" },
    ];
    views.forEach(function (v) {
      if (v.label.toLowerCase().includes(q) || v.id.includes(q)) {
        items.push({
          type: "view", label: v.label, icon: v.icon,
          action: function () { onSetView(v.id); },
        });
      }
    });

    return items;
  }, [query, events, turns, onSeek, onSetView]);

  useEffect(function () { setSelectedIdx(0); }, [query]);

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
      results[selectedIdx].action();
      onClose();
    }
    if (e.key === "Escape") {
      onClose();
    }
  }

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      paddingTop: 120, zIndex: theme.z.modal, backdropFilter: "blur(4px)",
    }}>
      <div onClick={function (e) { e.stopPropagation(); }} style={{
        width: 560, background: theme.bg.surface, border: "1px solid " + theme.border.strong,
        borderRadius: theme.radius.xxl, boxShadow: theme.shadow.drop,
        overflow: "hidden",
      }}>
        {/* Input */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 18px", borderBottom: "1px solid " + theme.border.default,
        }}>
          <span style={{ fontSize: 16, color: theme.accent.cyan }}>{"\u2315"}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={function (e) { setQuery(e.target.value); }}
            onKeyDown={handleKeyDown}
            placeholder="Search events, turns, tools..."
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: theme.text.primary, fontSize: theme.fontSize.md, fontFamily: theme.font,
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
            var itemColor = item.color || (
              item.type === "view" ? theme.accent.cyan
              : item.type === "turn" ? theme.accent.blue
              : theme.text.secondary
            );
            if (item.isError || item.hasError) itemColor = theme.error;

            return (
              <div
                key={i}
                onClick={function () { item.action(); onClose(); }}
                onMouseEnter={function () { setSelectedIdx(i); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 18px", cursor: "pointer",
                  background: isSelected ? theme.bg.raised : "transparent",
                  transition: "background " + theme.transition.fast,
                }}
              >
                <span style={{ fontSize: 12, color: itemColor, width: 16, textAlign: "center" }}>
                  {item.icon}
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
          <span>{"\u2191\u2193"} navigate</span>
          <span>{"\u21B5"} select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
