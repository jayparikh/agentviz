import { useRef } from "react";
import { FONT, TRACK_TYPES, ERROR_COLOR } from "../lib/constants.js";

export default function Timeline({ currentTime, totalTime, onSeek, isPlaying, onPlayPause, events, turns, searchResults, allEvents }) {
  var barRef = useRef(null);

  function handleClick(e) {
    var rect = barRef.current.getBoundingClientRect();
    var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(pct * totalTime);
  }

  var pct = totalTime > 0 ? (currentTime / totalTime) * 100 : 0;

  var counts = {};
  for (var i = 0; i < events.length; i++) {
    var t = events[i].track;
    counts[t] = (counts[t] || 0) + 1;
  }

  // Build search match set for fast lookup
  var matchSet = null;
  if (searchResults && allEvents) {
    matchSet = new Set();
    for (var i = 0; i < searchResults.length; i++) {
      matchSet.add(searchResults[i]);
    }
  }

  return (
    <div style={{ padding: "0 0 8px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <button
          onClick={onPlayPause}
          style={{
            background: "none", border: "1px solid #334155", borderRadius: 6,
            color: "#e2e8f0", cursor: "pointer", padding: "4px 12px", fontSize: 13,
            fontFamily: FONT, letterSpacing: 1,
          }}
        >
          {isPlaying ? "\u275A\u275A" : "\u25B6"}
        </button>
        <span style={{ fontFamily: FONT, fontSize: 12, color: "#94a3b8", letterSpacing: 1 }}>
          {currentTime.toFixed(1)}s / {totalTime.toFixed(1)}s
        </span>
        {/* Current turn indicator */}
        {turns && turns.length > 0 && (function () {
          var currentTurn = null;
          for (var i = 0; i < turns.length; i++) {
            if (currentTime >= turns[i].startTime && currentTime <= turns[i].endTime) {
              currentTurn = turns[i];
              break;
            }
          }
          if (!currentTurn && turns.length > 0) currentTurn = turns[turns.length - 1];
          if (!currentTurn) return null;
          return (
            <span style={{ fontSize: 10, color: "#475569", display: "flex", alignItems: "center", gap: 4 }}>
              Turn {currentTurn.index + 1}/{turns.length}
              {currentTurn.hasError && <span style={{ color: ERROR_COLOR }}>{"\u25CF"}</span>}
            </span>
          );
        })()}
        <div style={{ flex: 1 }} />
        {Object.keys(counts).map(function (track) {
          var info = TRACK_TYPES[track];
          if (!info) return null;
          return (
            <span key={track} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b" }}>
              <span style={{ color: info.color }}>{info.icon}</span>
              {counts[track]}
            </span>
          );
        })}
      </div>
      <div
        ref={barRef} onClick={handleClick}
        style={{
          height: 28, background: "#0f172a", borderRadius: 4, position: "relative",
          cursor: "crosshair", border: "1px solid #1e293b", overflow: "hidden",
        }}
      >
        {/* Turn boundary markers */}
        {turns && turns.map(function (turn, i) {
          if (i === 0) return null;
          var left = totalTime > 0 ? (turn.startTime / totalTime) * 100 : 0;
          return (
            <div key={"turn-" + i} style={{
              position: "absolute", left: left + "%", top: 0, bottom: 0,
              width: 1, background: "#334155", zIndex: 1,
              opacity: 0.6,
            }} />
          );
        })}
        {/* Event blocks */}
        {events.map(function (ev, i) {
          var left = totalTime > 0 ? (ev.t / totalTime) * 100 : 0;
          var w = Math.max(0.3, totalTime > 0 ? (ev.duration / totalTime) * 100 : 1);
          var info = TRACK_TYPES[ev.track];
          var color = ev.isError ? ERROR_COLOR : (info ? info.color : "#666");
          var isMatch = matchSet && allEvents && matchSet.has(allEvents.indexOf(ev));
          return (
            <div key={i} style={{
              position: "absolute", left: left + "%", width: w + "%",
              top: 2, bottom: 2, background: color,
              opacity: isMatch ? 0.9 : (ev.isError ? 0.7 : ev.intensity * 0.4),
              borderRadius: 2,
              boxShadow: isMatch ? "0 0 4px #22d3ee" : (ev.isError ? "0 0 4px " + ERROR_COLOR : "none"),
            }} />
          );
        })}
        {/* Playhead */}
        <div style={{
          position: "absolute", left: pct + "%", top: 0, bottom: 0, width: 2,
          background: "#22d3ee", boxShadow: "0 0 8px #22d3ee",
          transition: "left 0.08s linear", zIndex: 2,
        }} />
      </div>
    </div>
  );
}
