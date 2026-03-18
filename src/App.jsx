import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { parseClaudeCodeJSONL } from "./lib/parser.js";
import { FONT, SAMPLE_EVENTS, SAMPLE_TOTAL, SAMPLE_TURNS, SAMPLE_METADATA, TRACK_TYPES, ERROR_COLOR } from "./lib/constants.js";
import FileUploader from "./components/FileUploader.jsx";
import Timeline from "./components/Timeline.jsx";
import ReplayView from "./components/ReplayView.jsx";
import TracksView from "./components/TracksView.jsx";
import StatsView from "./components/StatsView.jsx";

var VIEWS = [
  { id: "replay", label: "Replay", icon: "\u25B6" },
  { id: "tracks", label: "Tracks", icon: "\u2261" },
  { id: "stats", label: "Stats", icon: "\u25FB" },
];

var SPEEDS = [0.5, 1, 2, 4, 8];

export default function App() {
  var [view, setView] = useState("replay");
  var [time, setTime] = useState(0);
  var [playing, setPlaying] = useState(false);
  var [speed, setSpeed] = useState(1);
  var [events, setEvents] = useState(null);
  var [turns, setTurns] = useState([]);
  var [metadata, setMetadata] = useState(null);
  var [total, setTotal] = useState(0);
  var [file, setFile] = useState("");
  var [error, setError] = useState(null);
  var [searchQuery, setSearchQuery] = useState("");
  var [trackFilters, setTrackFilters] = useState({});
  var interval = useRef(null);

  // ── Search matching ──

  var searchResults = useMemo(function () {
    if (!events || !searchQuery.trim()) return null;
    var q = searchQuery.toLowerCase();
    var matches = [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var hit = (ev.text && ev.text.toLowerCase().includes(q))
        || (ev.toolName && ev.toolName.toLowerCase().includes(q))
        || (ev.agent && ev.agent.toLowerCase().includes(q));
      if (hit) matches.push(i);
    }
    return matches;
  }, [events, searchQuery]);

  // ── Filtered events (track visibility) ──

  var filteredEvents = useMemo(function () {
    if (!events) return null;
    var activeFilters = Object.keys(trackFilters).filter(function (k) { return trackFilters[k]; });
    if (activeFilters.length === 0) return events;
    return events.filter(function (ev) { return !trackFilters[ev.track]; });
  }, [events, trackFilters]);

  // ── File loading ──

  var handleFile = useCallback(function (text, name) {
    setError(null);
    var result = parseClaudeCodeJSONL(text);
    if (!result || !result.events || result.events.length === 0) {
      setError("Could not parse any events. Make sure this is a Claude Code session JSONL file.");
      return;
    }
    var maxT = 0;
    for (var i = 0; i < result.events.length; i++) {
      var end = result.events[i].t + result.events[i].duration;
      if (end > maxT) maxT = end;
    }
    setEvents(result.events);
    setTurns(result.turns);
    setMetadata(result.metadata);
    setTotal(maxT);
    setFile(name);
    setTime(0);
    setPlaying(false);
    setSearchQuery("");
    setTrackFilters({});
  }, []);

  var loadSample = useCallback(function () {
    setEvents(SAMPLE_EVENTS);
    setTurns(SAMPLE_TURNS);
    setMetadata(SAMPLE_METADATA);
    setTotal(SAMPLE_TOTAL);
    setFile("demo-session.jsonl");
    setTime(0);
    setPlaying(false);
    setError(null);
    setSearchQuery("");
    setTrackFilters({});
  }, []);

  var reset = useCallback(function () {
    setEvents(null); setTurns([]); setMetadata(null);
    setFile(""); setTime(0); setPlaying(false);
    setError(null); setSearchQuery(""); setTrackFilters({});
  }, []);

  // ── Track filter toggle ──

  var toggleTrackFilter = useCallback(function (track) {
    setTrackFilters(function (prev) {
      var next = Object.assign({}, prev);
      if (next[track]) { delete next[track]; } else { next[track] = true; }
      return next;
    });
  }, []);

  // ── Playback ──

  useEffect(function () {
    if (playing) {
      interval.current = setInterval(function () {
        setTime(function (prev) {
          if (prev >= total) { setPlaying(false); return total; }
          return prev + 0.1 * speed;
        });
      }, 100);
    }
    return function () { clearInterval(interval.current); };
  }, [playing, speed, total]);

  var seek = useCallback(function (t) {
    setTime(Math.max(0, Math.min(total, t)));
  }, [total]);

  var playPause = useCallback(function () {
    setTime(function (prev) {
      if (prev >= total) return 0;
      return prev;
    });
    setPlaying(function (p) { return !p; });
  }, [total]);

  // ── Error navigation ──

  var jumpToError = useCallback(function (direction) {
    if (!events) return;
    var errorIndices = [];
    for (var i = 0; i < events.length; i++) {
      if (events[i].isError) errorIndices.push(i);
    }
    if (errorIndices.length === 0) return;

    if (direction === "next") {
      for (var i = 0; i < errorIndices.length; i++) {
        if (events[errorIndices[i]].t > time + 0.1) {
          seek(events[errorIndices[i]].t);
          return;
        }
      }
      seek(events[errorIndices[0]].t);
    } else {
      for (var i = errorIndices.length - 1; i >= 0; i--) {
        if (events[errorIndices[i]].t < time - 0.1) {
          seek(events[errorIndices[i]].t);
          return;
        }
      }
      seek(events[errorIndices[errorIndices.length - 1]].t);
    }
  }, [events, time, seek]);

  // ── Search navigation ──

  var jumpToMatch = useCallback(function (direction) {
    if (!searchResults || searchResults.length === 0 || !events) return;
    if (direction === "next") {
      for (var i = 0; i < searchResults.length; i++) {
        if (events[searchResults[i]].t > time + 0.1) {
          seek(events[searchResults[i]].t);
          return;
        }
      }
      seek(events[searchResults[0]].t);
    } else {
      for (var i = searchResults.length - 1; i >= 0; i--) {
        if (events[searchResults[i]].t < time - 0.1) {
          seek(events[searchResults[i]].t);
          return;
        }
      }
      seek(events[searchResults[searchResults.length - 1]].t);
    }
  }, [searchResults, events, time, seek]);

  // ── Keyboard shortcuts ──

  useEffect(function () {
    function handler(e) {
      if (!events) return;
      // Skip if user is typing in search
      if (e.target.tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); playPause(); }
      if (e.code === "ArrowRight") { e.preventDefault(); seek(time + 2); }
      if (e.code === "ArrowLeft") { e.preventDefault(); seek(time - 2); }
      if (e.key === "1") setView("replay");
      if (e.key === "2") setView("tracks");
      if (e.key === "3") setView("stats");
      if (e.key === "e") { e.preventDefault(); jumpToError("next"); }
      if (e.key === "E") { e.preventDefault(); jumpToError("prev"); }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        var searchInput = document.getElementById("agentviz-search");
        if (searchInput) searchInput.focus();
      }
    }
    window.addEventListener("keydown", handler);
    return function () { window.removeEventListener("keydown", handler); };
  });

  // ── Upload screen ──

  if (!events) {
    return (
      <div style={{
        width: "100%", height: "100vh", background: "#0a0f1e", color: "#e2e8f0",
        fontFamily: FONT, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 24,
      }}>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 36, color: "#22d3ee", marginBottom: 8 }}>{"\u25C8"}</div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 3 }}>AGENTVIZ</div>
          <div style={{ fontSize: 12, color: "#475569", marginTop: 4, letterSpacing: 1 }}>
            SESSION REPLAY FOR AGENT WORKFLOWS
          </div>
        </div>

        <FileUploader onLoad={handleFile} />

        {error && (
          <div style={{
            background: "#ef444420", border: "1px solid #ef4444", borderRadius: 8,
            padding: "10px 16px", fontSize: 12, color: "#fca5a5", maxWidth: 500,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div style={{ height: 1, width: 60, background: "#1e293b" }} />
          <span style={{ fontSize: 11, color: "#334155" }}>or</span>
          <div style={{ height: 1, width: 60, background: "#1e293b" }} />
        </div>

        <button onClick={loadSample} style={{
          background: "transparent", border: "1px solid #334155", borderRadius: 8,
          color: "#94a3b8", padding: "10px 24px", cursor: "pointer",
          fontSize: 12, fontFamily: FONT, letterSpacing: 1,
        }}>
          Load Demo Session
        </button>

        <div style={{ fontSize: 11, color: "#334155", maxWidth: 500, textAlign: "center", lineHeight: 1.8, marginTop: 16 }}>
          Find your Claude Code sessions:
          <br />
          <code style={{ color: "#475569" }}>ls ~/.claude/projects/</code>
          <br />
          Then drop any .jsonl session file here
        </div>
      </div>
    );
  }

  // ── Main visualizer ──

  var activeFilterCount = Object.keys(trackFilters).filter(function (k) { return trackFilters[k]; }).length;

  return (
    <div style={{
      width: "100%", height: "100vh", background: "#0a0f1e", color: "#e2e8f0",
      fontFamily: FONT, display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 20px", display: "flex", alignItems: "center", gap: 14,
        borderBottom: "1px solid #1e293b", flexShrink: 0,
      }}>
        <span style={{ fontSize: 16, color: "#22d3ee", cursor: "pointer" }} onClick={reset} title="Back">
          {"\u25C8"}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2 }}>AGENTVIZ</span>
        <div style={{ height: 16, width: 1, background: "#1e293b" }} />
        <span style={{
          fontSize: 11, color: "#64748b", maxWidth: 200,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {file}
        </span>
        {metadata && (
          <span style={{ fontSize: 10, color: "#334155" }}>
            {metadata.totalEvents} events / {metadata.totalToolCalls} tools / {metadata.totalTurns} turns
            {metadata.errorCount > 0 && (
              <span style={{ color: ERROR_COLOR, marginLeft: 6 }}>
                {"\u25CF"} {metadata.errorCount} error{metadata.errorCount > 1 ? "s" : ""}
              </span>
            )}
          </span>
        )}

        {/* View tabs */}
        <div style={{
          display: "flex", gap: 2, marginLeft: 16,
          background: "#0f172a", borderRadius: 6, padding: 2,
        }}>
          {VIEWS.map(function (v) {
            return (
              <button key={v.id} onClick={function () { setView(v.id); }} style={{
                background: view === v.id ? "#1e293b" : "transparent",
                border: "none", borderRadius: 4,
                color: view === v.id ? "#22d3ee" : "#64748b",
                padding: "4px 12px", cursor: "pointer",
                fontSize: 11, fontFamily: FONT, letterSpacing: 1,
                display: "flex", alignItems: "center", gap: 4,
              }}>
                <span>{v.icon}</span> {v.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div style={{ marginLeft: 12, display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
          <span style={{ fontSize: 12, color: "#475569" }}>{"\u2315"}</span>
          <input
            id="agentviz-search"
            type="text"
            value={searchQuery}
            onChange={function (e) { setSearchQuery(e.target.value); }}
            onKeyDown={function (e) {
              if (e.key === "Enter") { e.preventDefault(); jumpToMatch(e.shiftKey ? "prev" : "next"); }
              if (e.key === "Escape") { e.target.blur(); setSearchQuery(""); }
            }}
            placeholder="Search... (/)"
            style={{
              background: "#0f172a", border: "1px solid #1e293b", borderRadius: 4,
              color: "#e2e8f0", padding: "3px 8px", fontSize: 11, fontFamily: FONT,
              width: 140, outline: "none",
            }}
          />
          {searchResults && (
            <span style={{ fontSize: 10, color: searchResults.length > 0 ? "#22d3ee" : "#ef4444" }}>
              {searchResults.length} match{searchResults.length !== 1 ? "es" : ""}
            </span>
          )}
        </div>

        {/* Error nav */}
        {metadata && metadata.errorCount > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 6 }}>
            <button onClick={function () { jumpToError("prev"); }} title="Previous error (Shift+E)"
              style={{
                background: "transparent", border: "1px solid #ef444440", borderRadius: 3,
                color: ERROR_COLOR, cursor: "pointer", padding: "2px 5px", fontSize: 10, fontFamily: FONT,
              }}>
              {"\u25C0"}
            </button>
            <span style={{ fontSize: 10, color: ERROR_COLOR }}>{"\u25CF"} Errors</span>
            <button onClick={function () { jumpToError("next"); }} title="Next error (E)"
              style={{
                background: "transparent", border: "1px solid #ef444440", borderRadius: 3,
                color: ERROR_COLOR, cursor: "pointer", padding: "2px 5px", fontSize: 10, fontFamily: FONT,
              }}>
              {"\u25B6"}
            </button>
          </div>
        )}

        {/* Speed + close */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          {/* Track filter chips */}
          {Object.entries(TRACK_TYPES).map(function (entry) {
            var key = entry[0];
            var info = entry[1];
            var isHidden = trackFilters[key];
            return (
              <button key={key} onClick={function () { toggleTrackFilter(key); }}
                title={(isHidden ? "Show " : "Hide ") + info.label}
                style={{
                  background: isHidden ? "transparent" : info.color + "15",
                  border: "1px solid " + (isHidden ? "#1e293b" : info.color + "40"),
                  color: isHidden ? "#334155" : info.color,
                  borderRadius: 3, padding: "1px 6px", cursor: "pointer",
                  fontSize: 9, fontFamily: FONT, textDecoration: isHidden ? "line-through" : "none",
                }}>
                {info.icon}
              </button>
            );
          })}
          <div style={{ height: 12, width: 1, background: "#1e293b", margin: "0 2px" }} />
          <span style={{ fontSize: 10, color: "#475569" }}>SPEED</span>
          {SPEEDS.map(function (s) {
            return (
              <button key={s} onClick={function () { setSpeed(s); }} style={{
                background: speed === s ? "#22d3ee15" : "transparent",
                border: "1px solid " + (speed === s ? "#22d3ee" : "#1e293b"),
                color: speed === s ? "#22d3ee" : "#64748b",
                borderRadius: 4, padding: "2px 7px", cursor: "pointer",
                fontSize: 10, fontFamily: FONT,
              }}>
                {s}x
              </button>
            );
          })}
          <button onClick={reset} style={{
            background: "transparent", border: "1px solid #1e293b",
            color: "#64748b", borderRadius: 4, padding: "2px 8px",
            cursor: "pointer", fontSize: 10, fontFamily: FONT, marginLeft: 8,
          }}>
            {"\u2715"} Close
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ padding: "8px 20px 0", flexShrink: 0 }}>
        <Timeline
          currentTime={time} totalTime={total}
          onSeek={seek} isPlaying={playing} onPlayPause={playPause}
          events={filteredEvents} turns={turns}
          searchResults={searchResults} allEvents={events}
        />
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: "6px 20px 16px", minHeight: 0, overflow: "hidden" }}>
        {view === "replay" && (
          <ReplayView currentTime={time} events={filteredEvents} turns={turns}
            searchQuery={searchQuery} searchResults={searchResults} metadata={metadata} />
        )}
        {view === "tracks" && (
          <TracksView currentTime={time} events={filteredEvents} totalTime={total} turns={turns} />
        )}
        {view === "stats" && (
          <StatsView events={filteredEvents} totalTime={total} metadata={metadata} turns={turns} />
        )}
      </div>
    </div>
  );
}
