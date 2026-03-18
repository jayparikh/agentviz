import { useState, useEffect, useRef } from "react";
import { theme, AGENT_COLORS, TRACK_TYPES, alpha } from "../lib/theme.js";
import SyntaxHighlight from "./SyntaxHighlight.jsx";
import ResizablePanel from "./ResizablePanel.jsx";

function highlightText(text, query) {
  if (!query || !query.trim()) return text;
  var q = query.toLowerCase();
  var idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text;
  return [
    text.substring(0, idx),
    <span key="hl" style={{ background: alpha(theme.accent.cyan, 0.2), color: theme.accent.cyan, borderRadius: 2, padding: "0 1px" }}>
      {text.substring(idx, idx + query.length)}
    </span>,
    text.substring(idx + query.length),
  ];
}

export default function ReplayView({ currentTime, events, turns, searchQuery, searchResults, metadata }) {
  var visible = events.filter(function (e) { return e.t <= currentTime; });
  var containerRef = useRef(null);
  var [sel, setSel] = useState(null);
  var prevCount = useRef(0);

  useEffect(function () {
    if (containerRef.current && visible.length > prevCount.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    prevCount.current = visible.length;
  }, [visible.length]);

  var selected = sel !== null ? visible[sel] : visible[visible.length - 1];

  var tools = {};
  visible.forEach(function (e) {
    if (e.toolName) tools[e.toolName] = (tools[e.toolName] || 0) + 1;
  });

  var matchSet = null;
  if (searchResults) {
    matchSet = new Set(searchResults);
  }

  return (
    <ResizablePanel initialSplit={0.72} minPx={200} direction="horizontal">
      {/* Event stream */}
      <div ref={containerRef} style={{
        height: "100%", overflowY: "auto", padding: "4px 0",
        display: "flex", flexDirection: "column", gap: 2,
      }}>
        {visible.map(function (ev, i) {
          var info = TRACK_TYPES[ev.track];
          var ac = AGENT_COLORS[ev.agent] || theme.text.secondary;
          var isCurr = i === visible.length - 1;
          var isSel = i === sel;
          var isErr = ev.isError;
          var globalIdx = events.indexOf(ev);
          var isMatch = matchSet && matchSet.has(globalIdx);
          var isNew = i >= prevCount.current - 1;

          var turnHeader = null;
          if (turns && ev.agent === "user") {
            var turn = turns.find(function (t) { return t.eventIndices[0] === globalIdx; });
            if (turn && turn.index > 0) {
              turnHeader = (
                <div style={{
                  padding: "8px 12px 4px", display: "flex", alignItems: "center", gap: 8,
                  borderTop: "1px solid " + theme.border.default, marginTop: 8,
                }}>
                  <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2 }}>
                    Turn {turn.index + 1}
                  </span>
                  <div style={{ flex: 1, height: 1, background: theme.border.default }} />
                  {turn.toolCount > 0 && (
                    <span style={{ fontSize: theme.fontSize.xs, color: theme.accent.amber }}>{turn.toolCount} tools</span>
                  )}
                  {turn.hasError && (
                    <span style={{ fontSize: theme.fontSize.xs, color: theme.error }}>{"\u25CF"} error</span>
                  )}
                </div>
              );
            }
          }

          var borderColor = isErr ? theme.error : (isSel ? theme.accent.cyan : (isCurr ? ac + "80" : "transparent"));

          return (
            <div key={i}>
              {turnHeader}
              <div onClick={function () { setSel(i === sel ? null : i); }}
                style={{
                  display: "flex", gap: 10, padding: "7px 12px", borderRadius: theme.radius.lg,
                  background: isMatch ? alpha(theme.accent.cyan, 0.03) : (isSel ? theme.bg.raised : (isCurr ? theme.bg.overlay : "transparent")),
                  borderLeft: "3px solid " + borderColor,
                  opacity: isCurr || isSel || isMatch ? 1 : 0.55, cursor: "pointer",
                  transition: "all " + theme.transition.base,
                  animation: (isCurr && isNew) ? "slideIn 0.2s ease" : "none",
                }}
              >
                <div style={{ minWidth: 40, fontFamily: theme.font, fontSize: theme.fontSize.sm, color: theme.text.dim, paddingTop: 3 }}>
                  {ev.t.toFixed(1)}s
                </div>
                <div style={{
                  minWidth: 8, height: 8, borderRadius: "50%",
                  background: isErr ? theme.error : ac,
                  marginTop: 5,
                  boxShadow: isCurr ? theme.shadow.glowSm(isErr ? theme.error : ac) : "none",
                  animation: isCurr ? "pulse 2s ease-in-out infinite" : "none",
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, flexWrap: "wrap" }}>
                    <span style={{ fontSize: theme.fontSize.sm, fontWeight: 600, color: ac, textTransform: "uppercase", letterSpacing: 1 }}>
                      {ev.agent}
                    </span>
                    {info && (
                      <span style={{
                        fontSize: theme.fontSize.xs, color: isErr ? theme.error : info.color,
                        background: alpha(isErr ? theme.error : info.color, 0.08),
                        padding: "1px 5px", borderRadius: theme.radius.sm,
                      }}>
                        {info.icon} {info.label}
                      </span>
                    )}
                    {ev.toolName && (
                      <span style={{ fontSize: theme.fontSize.xs, color: theme.accent.amber, background: alpha(theme.accent.amber, 0.06), padding: "1px 5px", borderRadius: theme.radius.sm }}>
                        {ev.toolName}
                      </span>
                    )}
                    {isErr && (
                      <span style={{ fontSize: theme.fontSize.xs, color: theme.error, fontWeight: 600 }}>ERROR</span>
                    )}
                    {ev.model && isSel && (
                      <span style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>{ev.model}</span>
                    )}
                  </div>
                  <div style={{
                    fontSize: theme.fontSize.md, color: isErr ? theme.errorText : theme.text.primary, lineHeight: 1.5, fontFamily: theme.font,
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

      {/* Inspector sidebar */}
      <div style={{
        height: "100%", paddingLeft: 16,
        display: "flex", flexDirection: "column", gap: 14, overflowY: "auto",
      }}>
        {metadata && (
          <div>
            <div style={{ fontSize: theme.fontSize.sm, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>
              Session Info
            </div>
            <div style={{ fontSize: theme.fontSize.md, color: theme.text.secondary, lineHeight: 2.2 }}>
              <div>Events: <span style={{ color: theme.text.primary }}>{metadata.totalEvents}</span></div>
              <div>Turns: <span style={{ color: theme.text.primary }}>{metadata.totalTurns}</span></div>
              <div>Tools: <span style={{ color: theme.accent.amber }}>{metadata.totalToolCalls}</span></div>
              {metadata.errorCount > 0 && (
                <div>Errors: <span style={{ color: theme.error }}>{metadata.errorCount}</span></div>
              )}
              {metadata.primaryModel && (
                <div>Model: <span style={{ color: theme.accent.purple }}>{metadata.primaryModel.split("-").slice(0, 3).join("-")}</span></div>
              )}
              {metadata.tokenUsage && (
                <div>Tokens: <span style={{ color: theme.accent.cyan }}>
                  {(metadata.tokenUsage.inputTokens + metadata.tokenUsage.outputTokens).toLocaleString()}
                </span></div>
              )}
            </div>
          </div>
        )}

        <div>
          <div style={{ fontSize: theme.fontSize.sm, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>
            Tools Used
          </div>
          {Object.entries(tools).sort(function (a, b) { return b[1] - a[1]; }).map(function (pair) {
            return (
              <div key={pair[0]} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span style={{ fontSize: theme.fontSize.base, color: theme.accent.amber, fontFamily: theme.font }}>{pair[0]}</span>
                <span style={{ fontSize: theme.fontSize.base, color: theme.text.muted }}>{pair[1]}x</span>
              </div>
            );
          })}
        </div>

        {selected && (
          <div>
            <div style={{ fontSize: theme.fontSize.sm, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>
              {sel !== null ? "Selected Event" : "Current Event"}
            </div>
            <div style={{
              background: theme.bg.surface, borderRadius: theme.radius.lg, padding: 10,
              border: "1px solid " + alpha(selected.isError ? theme.error : ((TRACK_TYPES[selected.track] || {}).color || theme.text.ghost), 0.2),
            }}>
              {TRACK_TYPES[selected.track] && (
                <div style={{ fontSize: theme.fontSize.base, color: selected.isError ? theme.error : TRACK_TYPES[selected.track].color, marginBottom: 4 }}>
                  {TRACK_TYPES[selected.track].icon} {TRACK_TYPES[selected.track].label}
                  {selected.isError && " (ERROR)"}
                </div>
              )}
              <div style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}>Agent: {selected.agent}</div>
              <div style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}>Time: {selected.t.toFixed(2)}s</div>
              <div style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}>Turn: {(selected.turnIndex || 0) + 1}</div>
              {selected.toolName && (
                <div style={{ fontSize: theme.fontSize.base, color: theme.accent.amber, marginTop: 4 }}>Tool: {selected.toolName}</div>
              )}
              {selected.model && (
                <div style={{ fontSize: theme.fontSize.base, color: theme.accent.purple, marginTop: 4 }}>Model: {selected.model}</div>
              )}
            </div>
          </div>
        )}

        {selected && selected.raw && (
          <div>
            <div style={{ fontSize: theme.fontSize.sm, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>
              Raw Data
            </div>
            <SyntaxHighlight text={JSON.stringify(selected.raw, null, 2).substring(0, 2000)} maxLines={30} />
          </div>
        )}
      </div>
    </ResizablePanel>
  );
}
