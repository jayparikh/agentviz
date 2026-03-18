import { useState } from "react";
import { AGENT_COLORS, TRACK_TYPES, ERROR_COLOR } from "../lib/constants.js";

export default function TracksView({ currentTime, events, totalTime, turns }) {
  var [muted, setMuted] = useState({});
  var [solo, setSolo] = useState(null);
  var [hover, setHover] = useState(null);

  function toggleMute(key) {
    setSolo(null);
    setMuted(function (prev) {
      var next = Object.assign({}, prev);
      if (next[key]) { delete next[key]; } else { next[key] = true; }
      return next;
    });
  }

  function toggleSolo(key) {
    setMuted({});
    setSolo(function (prev) { return prev === key ? null : key; });
  }

  function isVis(key) {
    if (solo) return key === solo;
    return !muted[key];
  }

  var playPct = totalTime > 0 ? (currentTime / totalTime) * 100 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%", overflow: "auto" }}>
      {Object.entries(TRACK_TYPES).map(function (entry) {
        var key = entry[0];
        var info = entry[1];
        var trackEvts = events.filter(function (e) { return e.track === key; });
        var vis = isVis(key);

        return (
          <div key={key} style={{
            display: "flex", alignItems: "stretch", minHeight: 48,
            opacity: vis ? 1 : 0.15, transition: "opacity 0.2s",
          }}>
            {/* Label */}
            <div style={{
              width: 140, display: "flex", alignItems: "center", gap: 6,
              padding: "0 10px", borderRight: "1px solid #1e293b", flexShrink: 0,
            }}>
              <span style={{ color: info.color, fontSize: 14 }}>{info.icon}</span>
              <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>{info.label}</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
                <button onClick={function () { toggleSolo(key); }} style={{
                  background: solo === key ? info.color : "transparent",
                  border: "1px solid " + (solo === key ? info.color : "#334155"),
                  color: solo === key ? "#0f172a" : "#64748b",
                  borderRadius: 3, fontSize: 9, padding: "1px 4px", cursor: "pointer", fontWeight: 700,
                }}>S</button>
                <button onClick={function () { toggleMute(key); }} style={{
                  background: muted[key] ? "#ef4444" : "transparent",
                  border: "1px solid " + (muted[key] ? "#ef4444" : "#334155"),
                  color: muted[key] ? "#fff" : "#64748b",
                  borderRadius: 3, fontSize: 9, padding: "1px 4px", cursor: "pointer", fontWeight: 700,
                }}>M</button>
              </div>
              <span style={{ fontSize: 9, color: "#475569", minWidth: 20, textAlign: "right" }}>
                {trackEvts.length}
              </span>
            </div>

            {/* Lane */}
            <div style={{ flex: 1, position: "relative", background: "#0c1322", borderBottom: "1px solid #111827" }}>
              {/* Turn boundary markers */}
              {turns && turns.map(function (turn, ti) {
                if (ti === 0) return null;
                var left = totalTime > 0 ? (turn.startTime / totalTime) * 100 : 0;
                return (
                  <div key={"tb-" + ti} style={{
                    position: "absolute", left: left + "%", top: 0, bottom: 0,
                    width: 1, background: "#1e293b", zIndex: 0,
                  }} />
                );
              })}
              {trackEvts.map(function (ev, i) {
                var left = totalTime > 0 ? (ev.t / totalTime) * 100 : 0;
                var w = Math.max(1, totalTime > 0 ? (ev.duration / totalTime) * 100 : 2);
                var ac = AGENT_COLORS[ev.agent] || "#666";
                var active = currentTime >= ev.t && currentTime <= ev.t + ev.duration;
                var hk = key + "-" + i;
                var hovered = hover === hk;
                var isErr = ev.isError;

                var blockColor = isErr ? ERROR_COLOR : info.color;
                var intensityHex = Math.round(ev.intensity * 70).toString(16).padStart(2, "0");
                var agentHex = Math.round(ev.intensity * 40).toString(16).padStart(2, "0");

                return (
                  <div key={i}
                    onMouseEnter={function () { setHover(hk); }}
                    onMouseLeave={function () { setHover(null); }}
                    style={{
                      position: "absolute", left: left + "%", width: w + "%",
                      top: 4, bottom: 4, borderRadius: 4,
                      background: "linear-gradient(135deg, " + blockColor + intensityHex + ", " + ac + agentHex + ")",
                      border: active ? "1px solid " + blockColor : "1px solid transparent",
                      boxShadow: active ? "0 0 10px " + blockColor + "40"
                        : hovered ? "0 0 6px " + blockColor + "30"
                        : (isErr ? "inset 0 0 0 1px " + ERROR_COLOR + "60" : "none"),
                      cursor: "pointer",
                      display: "flex", alignItems: "center", padding: "0 5px", overflow: "hidden",
                      zIndex: active ? 2 : 1,
                    }}
                  >
                    {isErr && (
                      <span style={{ fontSize: 8, marginRight: 3, color: ERROR_COLOR }}>{"\u25CF"}</span>
                    )}
                    <span style={{
                      fontSize: 9, color: isErr ? "#fca5a5" : "#e2e8f0", whiteSpace: "nowrap",
                      overflow: "hidden", textOverflow: "ellipsis",
                      opacity: active ? 1 : 0.6,
                    }}>
                      {ev.toolName || ev.text.substring(0, 50)}
                    </span>
                  </div>
                );
              })}
              {/* Playhead */}
              <div style={{
                position: "absolute", left: playPct + "%",
                top: 0, bottom: 0, width: 1, background: "#22d3ee",
                boxShadow: "0 0 4px #22d3ee", zIndex: 3,
                transition: "left 0.08s linear",
              }} />
            </div>
          </div>
        );
      })}

      {/* Tooltip */}
      {hover && (function () {
        var parts = hover.split("-");
        var trackKey = parts[0];
        var idx = parseInt(parts[1]);
        var trackEvts = events.filter(function (e) { return e.track === trackKey; });
        var ev = trackEvts[idx];
        if (!ev) return null;
        var info = TRACK_TYPES[ev.track];
        return (
          <div style={{
            position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
            background: "#1e293b", border: "1px solid " + (ev.isError ? ERROR_COLOR + "60" : "#334155"),
            borderRadius: 8,
            padding: "8px 14px", maxWidth: 500, zIndex: 100,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}>
            {info && (
              <div style={{ fontSize: 11, color: ev.isError ? ERROR_COLOR : info.color, marginBottom: 4 }}>
                {info.icon} {info.label} @ {ev.t.toFixed(1)}s
                {ev.isError && " (ERROR)"}
              </div>
            )}
            <div style={{ fontSize: 11, color: ev.isError ? "#fca5a5" : "#cbd5e1", lineHeight: 1.5, wordBreak: "break-word" }}>
              {ev.text.substring(0, 200)}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
