import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { parseClaudeCodeJSONL } from "./lib/parser.js";
import { theme, TRACK_TYPES, alpha } from "./lib/theme.js";
import { SAMPLE_EVENTS, SAMPLE_TOTAL, SAMPLE_TURNS, SAMPLE_METADATA } from "./lib/constants.js";
import FileUploader from "./components/FileUploader.jsx";
import Timeline from "./components/Timeline.jsx";
import ReplayView from "./components/ReplayView.jsx";
import TracksView from "./components/TracksView.jsx";
import StatsView from "./components/StatsView.jsx";
import SessionHero from "./components/SessionHero.jsx";
import CommandPalette from "./components/CommandPalette.jsx";

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
  var [showHero, setShowHero] = useState(false);
  var [showPalette, setShowPalette] = useState(false);
  var [loading, setLoading] = useState(false);
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
    setLoading(true);

    // Use setTimeout so the loading UI renders before parsing blocks
    setTimeout(function () {
      var result = parseClaudeCodeJSONL(text);
      setLoading(false);
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
      setShowHero(true);
    }, 16);
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
    setShowHero(true);
  }, []);

  var reset = useCallback(function () {
    setEvents(null); setTurns([]); setMetadata(null);
    setFile(""); setTime(0); setPlaying(false);
    setError(null); setSearchQuery(""); setTrackFilters({});
    setShowHero(false); setShowPalette(false);
  }, []);

  var dismissHero = useCallback(function () {
    setShowHero(false);
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
      // Command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowPalette(function (p) { return !p; });
        return;
      }

      // Hero screen: space/enter to dismiss
      if (showHero && (e.code === "Space" || e.code === "Enter")) {
        e.preventDefault();
        dismissHero();
        return;
      }

      if (!events || showPalette) return;
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

  // ── Loading screen ──

  if (loading) {
    return (
      <div style={{
        width: "100%", height: "100vh", background: theme.bg.base, color: theme.text.primary,
        fontFamily: theme.font, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 20,
      }}>
        <div style={{
          width: 40, height: 40, border: "3px solid " + theme.border.default,
          borderTopColor: theme.accent.cyan, borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }} />
        <div style={{ fontSize: theme.fontSize.md, color: theme.text.muted, letterSpacing: 1 }}>
          Parsing session...
        </div>
      </div>
    );
  }

  // ── Upload screen ──

  if (!events) {
    return (
      <div style={{
        width: "100%", height: "100vh", background: theme.bg.base, color: theme.text.primary,
        fontFamily: theme.font, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 24,
        position: "relative", overflow: "hidden",
      }}>
        {/* Floating particles background */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
          {[0,1,2,3,4,5,6,7].map(function (i) {
            return (
              <div key={i} style={{
                position: "absolute",
                left: (10 + i * 12) + "%",
                bottom: -10,
                width: 2, height: 2, borderRadius: "50%",
                background: i % 2 === 0 ? theme.accent.cyan : theme.accent.purple,
                opacity: 0,
                animation: "floatParticle " + (8 + i * 2) + "s linear infinite",
                animationDelay: i * 1.5 + "s",
              }} />
            );
          })}
        </div>

        <div style={{ textAlign: "center", marginBottom: 8, animation: "fadeInUp 0.6s ease" }}>
          <div style={{
            fontSize: theme.fontSize.hero, color: theme.accent.cyan, marginBottom: 8,
            animation: "glow 3s ease-in-out infinite",
            display: "inline-block",
          }}>{"\u25C8"}</div>
          <div style={{ fontSize: theme.fontSize.xxl, fontWeight: 700, letterSpacing: 3 }}>AGENTVIZ</div>
          <div style={{ fontSize: theme.fontSize.md, color: theme.text.dim, marginTop: 6, letterSpacing: 1, lineHeight: 1.6 }}>
            See what your AI agents actually do.
            <br />
            <span style={{ color: theme.text.ghost }}>Drop a session file to start exploring.</span>
          </div>
        </div>

        <div style={{ animation: "fadeInUp 0.6s ease 0.1s both" }}>
          <FileUploader onLoad={handleFile} />
        </div>

        {error && (
          <div style={{
            background: theme.errorBg, border: "1px solid " + theme.error, borderRadius: theme.radius.xl,
            padding: "10px 16px", fontSize: theme.fontSize.md, color: theme.errorText, maxWidth: 500,
            animation: "fadeIn 0.3s ease",
          }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 16, alignItems: "center", animation: "fadeInUp 0.6s ease 0.2s both" }}>
          <div style={{ height: 1, width: 60, background: theme.border.default }} />
          <span style={{ fontSize: theme.fontSize.base, color: theme.text.ghost }}>or</span>
          <div style={{ height: 1, width: 60, background: theme.border.default }} />
        </div>

        <button onClick={loadSample} style={{
          background: "transparent", border: "1px solid " + theme.border.strong, borderRadius: theme.radius.xl,
          color: theme.text.secondary, padding: "10px 24px", cursor: "pointer",
          fontSize: theme.fontSize.md, fontFamily: theme.font, letterSpacing: 1,
          transition: "all " + theme.transition.smooth,
          animation: "fadeInUp 0.6s ease 0.3s both",
        }}
          onMouseEnter={function (e) { e.target.style.borderColor = theme.accent.cyan; e.target.style.color = theme.accent.cyan; }}
          onMouseLeave={function (e) { e.target.style.borderColor = theme.border.strong; e.target.style.color = theme.text.secondary; }}
        >
          Load Demo Session
        </button>

        <div style={{
          fontSize: theme.fontSize.base, color: theme.text.ghost, maxWidth: 500, textAlign: "center",
          lineHeight: 1.8, marginTop: 16, animation: "fadeInUp 0.6s ease 0.4s both",
        }}>
          Find your Claude Code sessions:
          <br />
          <code style={{ color: theme.text.dim }}>ls ~/.claude/projects/</code>
          <br />
          Then drop any .jsonl session file here
        </div>
      </div>
    );
  }

  // ── Session Hero ──

  if (showHero) {
    return (
      <div style={{
        width: "100%", height: "100vh", background: theme.bg.base, color: theme.text.primary,
        fontFamily: theme.font,
      }}>
        <SessionHero metadata={metadata} events={events} totalTime={total} onDive={dismissHero} />
      </div>
    );
  }

  // ── Main visualizer ──

  return (
    <div style={{
      width: "100%", height: "100vh", background: theme.bg.base, color: theme.text.primary,
      fontFamily: theme.font, display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* Command Palette */}
      {showPalette && (
        <CommandPalette
          events={events} turns={turns}
          onSeek={function (t) { seek(t); setShowPalette(false); }}
          onSetView={function (v) { setView(v); setShowPalette(false); }}
          onClose={function () { setShowPalette(false); }}
        />
      )}

      {/* Header */}
      <div style={{
        padding: "10px 20px", display: "flex", alignItems: "center", gap: 14,
        borderBottom: "1px solid " + theme.border.default, flexShrink: 0,
      }}>
        <span style={{ fontSize: 16, color: theme.accent.cyan, cursor: "pointer" }} onClick={reset} title="Back">
          {"\u25C8"}
        </span>
        <span style={{ fontSize: theme.fontSize.lg, fontWeight: 700, letterSpacing: 2 }}>AGENTVIZ</span>
        <div style={{ height: 16, width: 1, background: theme.border.default }} />
        <span style={{
          fontSize: theme.fontSize.base, color: theme.text.muted, maxWidth: 200,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {file}
        </span>
        {metadata && (
          <span style={{ fontSize: theme.fontSize.sm, color: theme.text.ghost }}>
            {metadata.totalEvents} events / {metadata.totalToolCalls} tools / {metadata.totalTurns} turns
            {metadata.errorCount > 0 && (
              <span style={{ color: theme.error, marginLeft: 6 }}>
                {"\u25CF"} {metadata.errorCount} error{metadata.errorCount > 1 ? "s" : ""}
              </span>
            )}
          </span>
        )}

        {/* View tabs */}
        <div style={{
          display: "flex", gap: 2, marginLeft: 16,
          background: theme.bg.surface, borderRadius: theme.radius.lg, padding: 2,
        }}>
          {VIEWS.map(function (v) {
            return (
              <button key={v.id} onClick={function () { setView(v.id); }} style={{
                background: view === v.id ? theme.bg.raised : "transparent",
                border: "none", borderRadius: theme.radius.md,
                color: view === v.id ? theme.accent.cyan : theme.text.muted,
                padding: "4px 12px", cursor: "pointer",
                fontSize: theme.fontSize.base, fontFamily: theme.font, letterSpacing: 1,
                display: "flex", alignItems: "center", gap: 4,
                transition: "all " + theme.transition.fast,
              }}>
                <span>{v.icon}</span> {v.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div style={{ marginLeft: 12, display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
          <span style={{ fontSize: 12, color: theme.text.dim }}>{"\u2315"}</span>
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
              background: theme.bg.surface, border: "1px solid " + theme.border.default, borderRadius: theme.radius.md,
              color: theme.text.primary, padding: "3px 8px", fontSize: theme.fontSize.base, fontFamily: theme.font,
              width: 140, outline: "none", transition: "border-color " + theme.transition.fast,
            }}
            onFocus={function (e) { e.target.style.borderColor = theme.accent.cyan; }}
            onBlur={function (e) { e.target.style.borderColor = theme.border.default; }}
          />
          {searchResults && (
            <span style={{ fontSize: theme.fontSize.sm, color: searchResults.length > 0 ? theme.accent.cyan : theme.error }}>
              {searchResults.length} match{searchResults.length !== 1 ? "es" : ""}
            </span>
          )}
        </div>

        {/* Cmd+K hint */}
        <button onClick={function () { setShowPalette(true); }}
          title="Command Palette (Cmd+K)"
          style={{
            background: theme.bg.surface, border: "1px solid " + theme.border.default,
            borderRadius: theme.radius.md, color: theme.text.dim,
            padding: "2px 8px", cursor: "pointer", fontSize: theme.fontSize.xs,
            fontFamily: theme.font, display: "flex", alignItems: "center", gap: 4,
            transition: "all " + theme.transition.fast,
          }}
          onMouseEnter={function (e) { e.currentTarget.style.borderColor = theme.accent.cyan; e.currentTarget.style.color = theme.accent.cyan; }}
          onMouseLeave={function (e) { e.currentTarget.style.borderColor = theme.border.default; e.currentTarget.style.color = theme.text.dim; }}
        >
          {"\u2318"}K
        </button>

        {/* Error nav */}
        {metadata && metadata.errorCount > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 6 }}>
            <button onClick={function () { jumpToError("prev"); }} title="Previous error (Shift+E)"
              style={{
                background: "transparent", border: "1px solid " + theme.errorBorder, borderRadius: theme.radius.sm,
                color: theme.error, cursor: "pointer", padding: "2px 5px", fontSize: theme.fontSize.sm, fontFamily: theme.font,
              }}>
              {"\u25C0"}
            </button>
            <span style={{ fontSize: theme.fontSize.sm, color: theme.error }}>{"\u25CF"} Errors</span>
            <button onClick={function () { jumpToError("next"); }} title="Next error (E)"
              style={{
                background: "transparent", border: "1px solid " + theme.errorBorder, borderRadius: theme.radius.sm,
                color: theme.error, cursor: "pointer", padding: "2px 5px", fontSize: theme.fontSize.sm, fontFamily: theme.font,
              }}>
              {"\u25B6"}
            </button>
          </div>
        )}

        {/* Speed + filters + close */}
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
                  background: isHidden ? "transparent" : alpha(info.color, 0.08),
                  border: "1px solid " + (isHidden ? theme.border.default : alpha(info.color, 0.25)),
                  color: isHidden ? theme.text.ghost : info.color,
                  borderRadius: theme.radius.sm, padding: "1px 6px", cursor: "pointer",
                  fontSize: theme.fontSize.xs, fontFamily: theme.font,
                  textDecoration: isHidden ? "line-through" : "none",
                  transition: "all " + theme.transition.fast,
                }}>
                {info.icon}
              </button>
            );
          })}
          <div style={{ height: 12, width: 1, background: theme.border.default, margin: "0 2px" }} />
          <span style={{ fontSize: theme.fontSize.sm, color: theme.text.dim }}>SPEED</span>
          {SPEEDS.map(function (s) {
            return (
              <button key={s} onClick={function () { setSpeed(s); }} style={{
                background: speed === s ? alpha(theme.accent.cyan, 0.08) : "transparent",
                border: "1px solid " + (speed === s ? theme.accent.cyan : theme.border.default),
                color: speed === s ? theme.accent.cyan : theme.text.muted,
                borderRadius: theme.radius.md, padding: "2px 7px", cursor: "pointer",
                fontSize: theme.fontSize.sm, fontFamily: theme.font,
                transition: "all " + theme.transition.fast,
              }}>
                {s}x
              </button>
            );
          })}
          <button onClick={reset} style={{
            background: "transparent", border: "1px solid " + theme.border.default,
            color: theme.text.muted, borderRadius: theme.radius.md, padding: "2px 8px",
            cursor: "pointer", fontSize: theme.fontSize.sm, fontFamily: theme.font, marginLeft: 8,
            transition: "all " + theme.transition.fast,
          }}
            onMouseEnter={function (e) { e.target.style.borderColor = theme.error; e.target.style.color = theme.error; }}
            onMouseLeave={function (e) { e.target.style.borderColor = theme.border.default; e.target.style.color = theme.text.muted; }}
          >
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
