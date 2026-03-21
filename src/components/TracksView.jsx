import { useState, useMemo } from "react";
import { theme, AGENT_COLORS, TRACK_TYPES, alpha } from "../lib/theme.js";

export default function TracksView({ currentTime, eventEntries, totalTime, timeMap, turns }) {
  var [muted, setMuted] = useState({});
  var [solo, setSolo] = useState(null);
  var [hoveredEntry, setHoveredEntry] = useState(null);

  function toggleMute(key) {
    setSolo(null);
    setMuted(function (prev) {
      var next = Object.assign({}, prev);
      if (next[key]) {
        delete next[key];
      } else {
        next[key] = true;
      }
      return next;
    });
  }

  function toggleSolo(key) {
    setMuted({});
    setSolo(function (prev) { return prev === key ? null : key; });
  }

  function isVisible(key) {
    if (solo) return key === solo;
    return !muted[key];
  }

  var playPct = timeMap ? timeMap.toPosition(currentTime) * 100 : (totalTime > 0 ? (currentTime / totalTime) * 100 : 0);

  var eventsByTrack = useMemo(function () {
    var grouped = {};
    Object.keys(TRACK_TYPES).forEach(function (key) { grouped[key] = []; });

    for (var i = 0; i < eventEntries.length; i++) {
      var entry = eventEntries[i];
      grouped[entry.event.track].push(entry);
    }

    return grouped;
  }, [eventEntries]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%", overflow: "auto" }}>
      {Object.entries(TRACK_TYPES).map(function (entry) {
        var key = entry[0];
        var info = entry[1];
        var trackEntries = eventsByTrack[key] || [];
        var visible = isVisible(key);

        return (
          <div key={key} style={{
            display: "flex",
            alignItems: "stretch",
            minHeight: 48,
            opacity: visible ? 1 : 0.15,
            transition: "opacity " + theme.transition.smooth,
          }}>
            <div style={{
              width: 140,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 10px",
              borderRight: "1px solid " + theme.border.default,
              flexShrink: 0,
            }}>
              <span style={{ color: info.color, fontSize: 14 }}>{info.icon}</span>
              <span style={{ fontSize: theme.fontSize.base, color: theme.text.secondary, fontWeight: 500 }}>{info.label}</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
                <button onClick={function () { toggleSolo(key); }} style={{
                  background: solo === key ? info.color : "transparent",
                  border: "1px solid " + (solo === key ? info.color : theme.border.strong),
                  color: solo === key ? theme.bg.surface : theme.text.muted,
                  borderRadius: theme.radius.sm,
                  fontSize: theme.fontSize.xs,
                  padding: "1px 4px",
                  cursor: "pointer",
                  fontWeight: 700,
                }}>S</button>
                <button onClick={function () { toggleMute(key); }} style={{
                  background: muted[key] ? theme.error : "transparent",
                  border: "1px solid " + (muted[key] ? theme.error : theme.border.strong),
                  color: muted[key] ? theme.text.primary : theme.text.muted,
                  borderRadius: theme.radius.sm,
                  fontSize: theme.fontSize.xs,
                  padding: "1px 4px",
                  cursor: "pointer",
                  fontWeight: 700,
                }}>M</button>
              </div>
              <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, minWidth: 20, textAlign: "right" }}>
                {trackEntries.length}
              </span>
            </div>

            <div style={{ flex: 1, position: "relative", background: theme.bg.base, borderBottom: "1px solid " + theme.border.subtle }}>
              {turns && turns.map(function (turn, ti) {
                if (ti === 0) return null;
                var left = timeMap ? timeMap.toPosition(turn.startTime) * 100 : (totalTime > 0 ? (turn.startTime / totalTime) * 100 : 0);
                return (
                  <div key={"tb-" + ti} style={{
                    position: "absolute",
                    left: left + "%",
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: theme.border.default,
                    zIndex: 0,
                  }} />
                );
              })}
              {trackEntries.map(function (trackEntry) {
                var ev = trackEntry.event;
                var left = timeMap ? timeMap.toPosition(ev.t) * 100 : (totalTime > 0 ? (ev.t / totalTime) * 100 : 0);
                var width = Math.max(1, timeMap ? (timeMap.toPosition(ev.t + ev.duration) - timeMap.toPosition(ev.t)) * 100 : (totalTime > 0 ? (ev.duration / totalTime) * 100 : 2));
                var agentColor = AGENT_COLORS[ev.agent] || theme.text.muted;
                var active = currentTime >= ev.t && currentTime <= ev.t + ev.duration;
                var hovered = hoveredEntry && hoveredEntry.index === trackEntry.index;
                var blockColor = ev.isError ? theme.error : info.color;

                return (
                  <div
                    key={trackEntry.index}
                    onMouseEnter={function () { setHoveredEntry(trackEntry); }}
                    onMouseLeave={function () { setHoveredEntry(null); }}
                    style={{
                      position: "absolute",
                      left: left + "%",
                      width: width + "%",
                      top: 4,
                      bottom: 4,
                      borderRadius: theme.radius.md,
                      background: "linear-gradient(135deg, " + alpha(blockColor, 0.45) + ", " + alpha(agentColor, 0.28) + ")",
                      border: "1px solid " + (active ? blockColor : "transparent"),
                      boxShadow: active
                        ? "0 0 10px " + alpha(blockColor, 0.25)
                        : hovered
                          ? "0 0 6px " + alpha(blockColor, 0.18)
                          : (ev.isError ? "inset 0 0 0 1px " + alpha(theme.error, 0.38) : "none"),
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 5px",
                      overflow: "hidden",
                      zIndex: active ? 2 : 1,
                    }}
                  >
                    {ev.isError && (
                      <span style={{ fontSize: 8, marginRight: 3, color: theme.error }}>{"\u25CF"}</span>
                    )}
                    <span style={{
                      fontSize: theme.fontSize.xs,
                      color: ev.isError ? theme.errorText : theme.text.primary,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      opacity: active ? 1 : 0.7,
                    }}>
                      {ev.toolName || ev.text.substring(0, 50)}
                    </span>
                  </div>
                );
              })}
              <div style={{
                position: "absolute",
                left: playPct + "%",
                top: 0,
                bottom: 0,
                width: 1,
                background: theme.accent.cyan,
                boxShadow: "0 0 4px " + theme.accent.cyan,
                zIndex: theme.z.playhead,
                transition: "left 0.08s linear",
              }} />
            </div>
          </div>
        );
      })}

      {hoveredEntry && (function () {
        var ev = hoveredEntry.event;
        var info = TRACK_TYPES[ev.track];
        return (
          <div style={{
            position: "fixed",
            bottom: 80,
            left: "50%",
            transform: "translateX(-50%)",
            background: theme.bg.raised,
            border: "1px solid " + (ev.isError ? alpha(theme.error, 0.38) : theme.border.strong),
            borderRadius: theme.radius.xl,
            padding: "8px 14px",
            maxWidth: 500,
            zIndex: theme.z.modal,
            boxShadow: theme.shadow.drop,
          }}>
            {info && (
              <div style={{ fontSize: theme.fontSize.base, color: ev.isError ? theme.error : info.color, marginBottom: 4 }}>
                {info.icon} {info.label} @ {ev.t.toFixed(1)}s
                {ev.isError && " (ERROR)"}
              </div>
            )}
            <div style={{ fontSize: theme.fontSize.base, color: ev.isError ? theme.errorText : theme.text.primary, lineHeight: 1.5, wordBreak: "break-word" }}>
              {ev.text.substring(0, 200)}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
