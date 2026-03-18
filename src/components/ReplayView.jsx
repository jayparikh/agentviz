import { useState, useEffect, useRef } from "react";
import { FONT, AGENT_COLORS, TRACK_TYPES, ERROR_COLOR } from "../lib/constants.js";

function highlightText(text, query) {
  if (!query || !query.trim()) return text;
  var q = query.toLowerCase();
  var idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text;
  return [
    text.substring(0, idx),
    <span key="hl" style={{ background: "#22d3ee30", color: "#22d3ee", borderRadius: 2, padding: "0 1px" }}>
      {text.substring(idx, idx + query.length)}
    </span>,
    text.substring(idx + query.length),
  ];
}

export default function ReplayView({ currentTime, events, turns, searchQuery, searchResults, metadata }) {
  var visible = events.filter(function (e) { return e.t <= currentTime; });
  var containerRef = useRef(null);
  var [sel, setSel] = useState(null);

  useEffect(function () {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visible.length]);

  var selected = sel !== null ? visible[sel] : visible[visible.length - 1];

  // Tool usage counts
  var tools = {};
  visible.forEach(function (e) {
    if (e.toolName) tools[e.toolName] = (tools[e.toolName] || 0) + 1;
  });

  // Build search match set
  var matchSet = null;
  if (searchResults) {
    matchSet = new Set(searchResults);
  }

  // Find turn boundaries in visible events
  var turnBoundaries = {};
  if (turns) {
    for (var i = 0; i < turns.length; i++) {
      turnBoundaries[turns[i].startTime] = turns[i];
    }
  }

  return (
    <div style={{ display: "flex", gap: 16, height: "100%", minHeight: 0 }}>
      {/* Event stream */}
      <div ref={containerRef} style={{
        flex: 1, overflowY: "auto", padding: "4px 0",
        display: "flex", flexDirection: "column", gap: 2,
      }}>
        {visible.map(function (ev, i) {
          var info = TRACK_TYPES[ev.track];
          var ac = AGENT_COLORS[ev.agent] || "#94a3b8";
          var isCurr = i === visible.length - 1;
          var isSel = i === sel;
          var isErr = ev.isError;
          var globalIdx = events.indexOf(ev);
          var isMatch = matchSet && matchSet.has(globalIdx);

          // Check if this event starts a new turn
          var turnHeader = null;
          if (turns && ev.agent === "user") {
            var turn = turns.find(function (t) { return t.eventIndices[0] === globalIdx; });
            if (turn && turn.index > 0) {
              turnHeader = (
                <div style={{
                  padding: "8px 12px 4px", display: "flex", alignItems: "center", gap: 8,
                  borderTop: "1px solid #1e293b", marginTop: 8,
                }}>
                  <span style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: 2 }}>
                    Turn {turn.index + 1}
                  </span>
                  <div style={{ flex: 1, height: 1, background: "#1e293b" }} />
                  {turn.toolCount > 0 && (
                    <span style={{ fontSize: 9, color: "#f59e0b" }}>{turn.toolCount} tools</span>
                  )}
                  {turn.hasError && (
                    <span style={{ fontSize: 9, color: ERROR_COLOR }}>{"\u25CF"} error</span>
                  )}
                </div>
              );
            }
          }

          var borderColor = isErr ? ERROR_COLOR : (isSel ? "#22d3ee" : (isCurr ? ac + "80" : "transparent"));

          return (
            <div key={i}>
              {turnHeader}
              <div onClick={function () { setSel(i === sel ? null : i); }}
                style={{
                  display: "flex", gap: 10, padding: "7px 12px", borderRadius: 6,
                  background: isMatch ? "#22d3ee08" : (isSel ? "#1e293b" : (isCurr ? "#151e2e" : "transparent")),
                  borderLeft: "3px solid " + borderColor,
                  opacity: isCurr || isSel || isMatch ? 1 : 0.55, cursor: "pointer",
                  transition: "background 0.15s, opacity 0.15s",
                }}
              >
                <div style={{ minWidth: 40, fontFamily: FONT, fontSize: 10, color: "#475569", paddingTop: 3 }}>
                  {ev.t.toFixed(1)}s
                </div>
                <div style={{
                  minWidth: 8, height: 8, borderRadius: "50%",
                  background: isErr ? ERROR_COLOR : ac,
                  marginTop: 5, boxShadow: isCurr ? "0 0 6px " + (isErr ? ERROR_COLOR : ac) : "none",
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: ac, textTransform: "uppercase", letterSpacing: 1 }}>
                      {ev.agent}
                    </span>
                    {info && (
                      <span style={{
                        fontSize: 9, color: isErr ? ERROR_COLOR : info.color,
                        background: (isErr ? ERROR_COLOR : info.color) + "15",
                        padding: "1px 5px", borderRadius: 3,
                      }}>
                        {info.icon} {info.label}
                      </span>
                    )}
                    {ev.toolName && (
                      <span style={{ fontSize: 9, color: "#f59e0b", background: "#f59e0b12", padding: "1px 5px", borderRadius: 3 }}>
                        {ev.toolName}
                      </span>
                    )}
                    {isErr && (
                      <span style={{ fontSize: 9, color: ERROR_COLOR, fontWeight: 600 }}>ERROR</span>
                    )}
                    {ev.model && isSel && (
                      <span style={{ fontSize: 9, color: "#64748b" }}>{ev.model}</span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 12, color: isErr ? "#fca5a5" : "#cbd5e1", lineHeight: 1.5, fontFamily: FONT,
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {highlightText(ev.text, searchQuery)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Inspector */}
      <div style={{
        width: 260, borderLeft: "1px solid #1e293b", paddingLeft: 16,
        display: "flex", flexDirection: "column", gap: 14, overflowY: "auto",
      }}>
        {/* Session info */}
        {metadata && (
          <div>
            <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>
              Session Info
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 2.2 }}>
              <div>Events: <span style={{ color: "#e2e8f0" }}>{metadata.totalEvents}</span></div>
              <div>Turns: <span style={{ color: "#e2e8f0" }}>{metadata.totalTurns}</span></div>
              <div>Tools: <span style={{ color: "#f59e0b" }}>{metadata.totalToolCalls}</span></div>
              {metadata.errorCount > 0 && (
                <div>Errors: <span style={{ color: ERROR_COLOR }}>{metadata.errorCount}</span></div>
              )}
              {metadata.primaryModel && (
                <div>Model: <span style={{ color: "#a78bfa" }}>{metadata.primaryModel.split("-").slice(0, 3).join("-")}</span></div>
              )}
              {metadata.tokenUsage && (
                <div>Tokens: <span style={{ color: "#22d3ee" }}>
                  {(metadata.tokenUsage.inputTokens + metadata.tokenUsage.outputTokens).toLocaleString()}
                </span></div>
              )}
            </div>
          </div>
        )}

        {/* Tools used */}
        <div>
          <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>
            Tools Used
          </div>
          {Object.entries(tools).sort(function (a, b) { return b[1] - a[1]; }).map(function (pair) {
            return (
              <div key={pair[0]} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span style={{ fontSize: 11, color: "#f59e0b", fontFamily: FONT }}>{pair[0]}</span>
                <span style={{ fontSize: 11, color: "#64748b" }}>{pair[1]}x</span>
              </div>
            );
          })}
        </div>

        {/* Selected event */}
        {selected && (
          <div>
            <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>
              {sel !== null ? "Selected Event" : "Current Event"}
            </div>
            <div style={{
              background: "#0f172a", borderRadius: 6, padding: 10,
              border: "1px solid " + (selected.isError ? ERROR_COLOR + "40" : ((TRACK_TYPES[selected.track] || {}).color || "#333") + "30"),
            }}>
              {TRACK_TYPES[selected.track] && (
                <div style={{ fontSize: 11, color: selected.isError ? ERROR_COLOR : TRACK_TYPES[selected.track].color, marginBottom: 4 }}>
                  {TRACK_TYPES[selected.track].icon} {TRACK_TYPES[selected.track].label}
                  {selected.isError && " (ERROR)"}
                </div>
              )}
              <div style={{ fontSize: 11, color: "#94a3b8" }}>Agent: {selected.agent}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>Time: {selected.t.toFixed(2)}s</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>Turn: {(selected.turnIndex || 0) + 1}</div>
              {selected.toolName && (
                <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 4 }}>Tool: {selected.toolName}</div>
              )}
              {selected.model && (
                <div style={{ fontSize: 11, color: "#a78bfa", marginTop: 4 }}>Model: {selected.model}</div>
              )}
            </div>
          </div>
        )}

        {/* Raw JSON */}
        {selected && selected.raw && (
          <div>
            <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>
              Raw Data
            </div>
            <pre style={{
              background: "#0a0f1e", borderRadius: 6, padding: 8,
              fontSize: 9, color: "#64748b", overflow: "auto", maxHeight: 200,
              border: "1px solid #1e293b", whiteSpace: "pre-wrap", wordBreak: "break-all",
              lineHeight: 1.5,
            }}>
              {JSON.stringify(selected.raw, null, 2).substring(0, 1500)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
