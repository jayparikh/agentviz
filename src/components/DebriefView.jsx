import { useState, useEffect, useRef } from "react";
import { theme, alpha } from "../lib/theme.js";
import { getRelevantSurfaces, parseMcpServerNames, parseSkillNames } from "../lib/projectConfig.js";
// ─────────────────────────────────────────────────────────────────────────────
// Coach analysis cache (localStorage)
// ─────────────────────────────────────────────────────────────────────────────
var CACHE_PREFIX = "agentviz:coach:v1:";
function loadCachedAnalysis(file) {
  try { var raw = localStorage.getItem(CACHE_PREFIX + file); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function saveCachedAnalysis(file, data) {
  try { localStorage.setItem(CACHE_PREFIX + file, JSON.stringify(data)); } catch (e) {}
}
function clearCachedAnalysis(file) {
  try { localStorage.removeItem(CACHE_PREFIX + file); } catch (e) {}
}

export default function DebriefView({ file, summary, metadata, rawSession }) {
  var [configFiles, setConfigFiles] = useState([]);
  var [configLoaded, setConfigLoaded] = useState(false);
  var [showConfigExplorer, setShowConfigExplorer] = useState(true);
  var [expandedSurface, setExpandedSurface] = useState(null);
  var [aiAnalysis, setAiAnalysis] = useState(null);
  var [aiStatus, setAiStatus] = useState(null); // null | "loading" | "done" | "error"
  var [aiError, setAiError] = useState(null);
  var [aiSteps, setAiSteps] = useState([]); // [{type, label}] live step log
  var [aiModelInfo, setAiModelInfo] = useState(null); // { model, usage }
  var [aiApplyStatus, setAiApplyStatus] = useState({}); // { recIdx: "applying"|"applied"|"error" }
  var [aiApplyHistory, setAiApplyHistory] = useState({}); // { recIdx: { original: string|null, path: string } }
  var [aiPreview, setAiPreview] = useState({}); // { recIdx: true } -- show preview pane
  var aiAbortRef = useRef(null);
  var autoStartedRef = useRef(false);

  useEffect(function () {
    fetch("/api/config")
      .then(function (r) { return r.json(); })
      .then(function (data) { setConfigFiles(data); setConfigLoaded(true); })
      .catch(function () { setConfigLoaded(true); });
  }, []);

  // Auto-start AI analysis once config + session are ready; use cache if available
  useEffect(function () {
    if (!rawSession || !configLoaded || !file) return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    var cached = loadCachedAnalysis(file);
    if (cached) {
      setAiAnalysis(cached.recommendations);
      setAiModelInfo(cached.modelInfo || null);
      setAiStatus("done");
      return;
    }
    // Small delay so config files are populated before the agent reads them
    var t = setTimeout(function () { handleAiAnalyze(); }, 200);
    return function () { clearTimeout(t); };
  }, [rawSession, configLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildAnalysisPayload() {
    var m = rawSession.autonomyMetrics || {};
    var met = rawSession.metadata || {};

    // Extract existing skills and MCP server names from loaded config files
    var existingSkills = [];
    var existingMcpServers = [];
    for (var ci = 0; ci < configFiles.length; ci++) {
      var cf = configFiles[ci];
      if (!cf.exists) continue;
      if (cf.id === "github-skills" || cf.id === "github-extensions" || cf.id === "github-prompts" ||
          cf.id === "claude-skills") {
        var names = parseSkillNames(cf);
        existingSkills = existingSkills.concat(names);
      }
      if (cf.id === "mcp-json") {
        var mcpNames = cf.mcpServers || parseMcpServerNames(cf.content);
        existingMcpServers = existingMcpServers.concat(mcpNames);
      }
    }

    return {
      format: met.format || "claude-code",
      primaryModel: met.primaryModel || null,
      totalEvents: met.totalEvents || 0,
      totalTurns: met.totalTurns || 0,
      errorCount: met.errorCount || 0,
      totalToolCalls: met.totalToolCalls || 0,
      productiveRuntime: m.productiveRuntime ? Math.round(m.productiveRuntime) + "s" : "0s",
      humanResponseTime: m.babysittingTime ? Math.round(m.babysittingTime) + "s" : "0s",
      idleTime: m.idleTime ? Math.round(m.idleTime) + "s" : "0s",
      interventions: m.interventionCount || 0,
      autonomyEfficiency: m.autonomyEfficiency != null ? Math.round(m.autonomyEfficiency * 100) + "%" : "0%",
      topTools: m.topTools || [],
      userFollowUps: m.userFollowUps || [],
      errorSamples: (rawSession.events || [])
        .filter(function (e) { return e.isError && e.text; })
        .slice(0, 6)
        .map(function (e) { return (e.toolName ? "[" + e.toolName + "] " : "") + e.text.substring(0, 150); }),
      existingSkills: existingSkills,
      existingMcpServers: existingMcpServers,
    };
  }

  function handleAiAnalyze() {
    if (!rawSession) return;
    if (aiAbortRef.current) aiAbortRef.current.abort();
    var controller = new AbortController();
    aiAbortRef.current = controller;
    setAiStatus("loading");
    setAiError(null);
    setAiAnalysis(null);
    setAiSteps([]);
    setAiApplyStatus({});
    setAiApplyHistory({});
    setAiPreview({});

    var body = JSON.stringify(buildAnalysisPayload());

    fetch("/api/coach/analyze", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
      body: body,
    }).then(function (resp) {
      if (!resp.ok) {
        return resp.json().then(function (d) { throw new Error(d.error || "HTTP " + resp.status); });
      }
      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";

      function pump() {
        reader.read().then(function (ref) {
          if (ref.done) return;
          buffer += decoder.decode(ref.value, { stream: true });
          var lines = buffer.split("\n");
          buffer = lines.pop();
          lines.forEach(function (line) {
            if (!line.startsWith("data: ")) return;
            try {
              var msg = JSON.parse(line.slice(6));
              if (msg.step) {
                setAiSteps(function (prev) { return prev.concat(msg.step); });
              }
              if (msg.done && msg.result) {
                var modelInfo = { model: msg.result.model, usage: msg.result.usage };
                setAiAnalysis(msg.result.recommendations);
                setAiModelInfo(modelInfo);
                saveCachedAnalysis(file, { recommendations: msg.result.recommendations, modelInfo: modelInfo, cachedAt: new Date().toISOString() });
                setAiStatus("done");
              }
              if (msg.error) {
                setAiError(msg.error);
                setAiStatus("error");
              }
            } catch (e) { /* ignore malformed SSE lines */ }
          });
          pump();
        }).catch(function (e) {
          if (e.name === "AbortError") return;
          setAiError(e.message);
          setAiStatus("error");
        });
      }
      pump();
    }).catch(function (e) {
      if (e.name === "AbortError") return;
      setAiError(e.message);
      setAiStatus("error");
    });
  }

  function handleAiCancel() {
    if (aiAbortRef.current) { aiAbortRef.current.abort(); aiAbortRef.current = null; }
    setAiStatus(null);
    setAiSteps([]);
  }

  function handleAiRedo() {
    clearCachedAnalysis(file);
    handleAiAnalyze();
  }

  function toggleAiPreview(idx) {
    setAiPreview(function (prev) { return Object.assign({}, prev, { [idx]: !prev[idx] }); });
  }

  function handleAiRecApply(rec, idx) {
    if (!rec.targetPath || !rec.draft) return;
    setAiApplyStatus(function (prev) { return Object.assign({}, prev, { [idx]: "applying" }); });
    setAiPreview(function (prev) { return Object.assign({}, prev, { [idx]: false }); });
    fetch("/api/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: rec.targetPath, content: rec.draft, mode: "append" }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.success) {
        setAiApplyStatus(function (prev) { return Object.assign({}, prev, { [idx]: "applied" }); });
        // Store original content so user can revert
        setAiApplyHistory(function (prev) {
          return Object.assign({}, prev, { [idx]: { original: data.originalContent, path: rec.targetPath } });
        });
      } else {
        setAiApplyStatus(function (prev) { return Object.assign({}, prev, { [idx]: "error" }); });
      }
    }).catch(function () {
      setAiApplyStatus(function (prev) { return Object.assign({}, prev, { [idx]: "error" }); });
    });
  }

  function handleAiRecRevert(idx) {
    var history = aiApplyHistory[idx];
    if (!history) return;
    setAiApplyStatus(function (prev) { return Object.assign({}, prev, { [idx]: "applying" }); });
    var revertContent = history.original !== null ? history.original : "";
    fetch("/api/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: history.path, content: revertContent, mode: "overwrite" }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.success) {
        setAiApplyStatus(function (prev) { return Object.assign({}, prev, { [idx]: null }); });
        setAiApplyHistory(function (prev) { var n = Object.assign({}, prev); delete n[idx]; return n; });
      } else {
        setAiApplyStatus(function (prev) { return Object.assign({}, prev, { [idx]: "error" }); });
      }
    }).catch(function () {
      setAiApplyStatus(function (prev) { return Object.assign({}, prev, { [idx]: "error" }); });
    });
  }

  function findConfigResult(surfaceId) {
    for (var i = 0; i < configFiles.length; i++) {
      if (configFiles[i].id === surfaceId) return configFiles[i];
    }
    return null;
  }

  function getSurfacePreview(result) {
    if (!result || !result.exists) return null;
    if (result.entries) return result.entries.length + " file" + (result.entries.length === 1 ? "" : "s");
    if (result.content) return result.content.substring(0, 80) + (result.content.length > 80 ? "..." : "");
    return "1 file";
  }

  function getSurfaceFullContent(result) {
    if (!result || !result.exists) return null;
    if (result.content) return result.content;
    if (result.entries && result.entries.length > 0) {
      return result.entries.map(function (e) {
        return "--- " + e.path + " ---\n" + e.content;
      }).join("\n\n");
    }
    return null;
  }

  // Shared renderer for AI recommendation cards (used in both loading + done states)
  function renderAiRecCard(rec, i, totalCount) {
    var applyState = aiApplyStatus[i] || null;
    var hasHistory = !!aiApplyHistory[i];
    var showPreview = !!aiPreview[i];
    var canApply = rec.targetPath && rec.draft && applyState !== "applied";
    return (
      <div key={i} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: i < totalCount - 1 ? "1px solid " + theme.border.default : "none" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          {rec.priority === "high" && (
            <span style={{ fontSize: theme.fontSize.xs, color: theme.semantic.error, border: "1px solid " + theme.semantic.errorBorder, borderRadius: theme.radius.full, padding: "1px 7px", flexShrink: 0, marginTop: 2 }}>high</span>
          )}
          <span style={{ fontSize: theme.fontSize.md, color: theme.text.primary, fontFamily: theme.font.ui, fontWeight: 600, flex: 1 }}>{rec.title}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {applyState === "error" && (
              <span style={{ fontSize: theme.fontSize.xs, color: theme.semantic.error }}>Apply failed</span>
            )}
            {applyState === "applied" && (
              <>
                <span style={{ fontSize: theme.fontSize.xs, color: theme.semantic.success }}>{"✓ Applied"}</span>
                {hasHistory && (
                  <button className="av-btn" onClick={function () { handleAiRecRevert(i); }}
                    style={{ fontSize: theme.fontSize.xs, fontFamily: theme.font.ui, border: "1px solid " + theme.semantic.warning, background: "transparent", color: theme.semantic.warning, borderRadius: theme.radius.md, padding: "2px 8px", cursor: "pointer" }}>
                    Revert
                  </button>
                )}
              </>
            )}
            {canApply && rec.draft && !showPreview && (
              <button className="av-btn" onClick={function () { toggleAiPreview(i); }}
                title="Preview changes before applying"
                style={{ fontSize: theme.fontSize.xs, fontFamily: theme.font.ui, border: "1px solid " + theme.border.default, background: "transparent", color: theme.text.secondary, borderRadius: theme.radius.md, padding: "2px 8px", cursor: "pointer" }}>
                Preview
              </button>
            )}
            {canApply && (
              <button className="av-btn" onClick={function () { handleAiRecApply(rec, i); }}
                disabled={applyState === "applying"}
                title={"Apply to " + rec.targetPath}
                style={{ fontSize: theme.fontSize.xs, fontFamily: theme.font.ui, border: "1px solid " + theme.semantic.success, background: alpha(theme.semantic.success, 0.08), color: theme.semantic.success, borderRadius: theme.radius.md, padding: "2px 10px", cursor: "pointer" }}>
                {applyState === "applying" ? "Applying..." : "Apply \u2192 " + rec.targetPath}
              </button>
            )}
            {!rec.targetPath && rec.draft && (
              <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, fontStyle: "italic" }}>advice only</span>
            )}
          </div>
        </div>
        <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, marginBottom: rec.fix ? 5 : (rec.draft ? 6 : 0), lineHeight: 1.5 }}>{rec.summary}</div>
        {rec.fix && <div style={{ fontSize: theme.fontSize.sm, color: theme.text.secondary, lineHeight: 1.5, marginBottom: rec.draft ? 6 : 0 }}><strong>Fix:</strong> {rec.fix}</div>}
        {rec.draft && !showPreview && (
          <pre style={{ fontSize: theme.fontSize.xs, background: theme.bg.base, border: "1px solid " + theme.border.default, borderRadius: theme.radius.md, padding: "8px 12px", overflowX: "auto", whiteSpace: "pre-wrap", color: theme.text.secondary, margin: 0, cursor: "pointer" }}
            onClick={function () { toggleAiPreview(i); }} title="Click to preview/collapse">
            {rec.draft}
          </pre>
        )}
        {showPreview && rec.draft && (
          <div style={{ border: "1px solid " + theme.semantic.success, borderRadius: theme.radius.md, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 10px", background: alpha(theme.semantic.success, 0.06), borderBottom: "1px solid " + alpha(theme.semantic.success, 0.2) }}>
              <span style={{ fontSize: theme.fontSize.xs, color: theme.semantic.success }}>
                {"+ will append to " + rec.targetPath}
              </span>
              <button className="av-btn" onClick={function () { toggleAiPreview(i); }}
                style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, background: "none", border: "none", cursor: "pointer", padding: "0 4px" }}>
                {"collapse"}
              </button>
            </div>
            <pre style={{ fontSize: theme.fontSize.xs, background: theme.bg.base, padding: "8px 12px", overflowX: "auto", whiteSpace: "pre-wrap", margin: 0, color: theme.semantic.success }}>
              {rec.draft.split("\n").map(function (line) { return "+ " + line; }).join("\n")}
            </pre>
          </div>
        )}
      </div>
    );
  }

  var liveRecs = aiStatus === "loading"
    ? aiSteps.filter(function (s) { return s.type === "recommend" && s.rec; }).map(function (s) { return s.rec; })
    : [];
  var progressStep = null;
  if (aiStatus === "loading") {
    for (var si = aiSteps.length - 1; si >= 0; si--) {
      if (aiSteps[si].type !== "recommend" && aiSteps[si].type !== "done") { progressStep = aiSteps[si]; break; }
    }
  }

  return (
    <div style={{ display: "flex", gap: 20, height: "100%", overflow: "hidden" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", paddingRight: 4 }}>
        <div>
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2 }}>
            Coach
          </div>
          <div style={{ fontSize: theme.fontSize.xl, color: theme.text.primary, marginTop: 8, fontFamily: theme.font.ui }}>
            {"Session coaching: " + file}
          </div>
          <div style={{ fontSize: theme.fontSize.md, color: theme.text.muted, marginTop: 6, lineHeight: 1.7 }}>
            Review evidence-backed drafts. Accept to apply, ignore to skip.
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10 }}>
          {summary.map(function (item) {
            return (
              <div
                key={item.label}
                style={{
                  background: theme.bg.surface,
                  border: "1px solid " + theme.border.default,
                  borderRadius: theme.radius.xl,
                  padding: "12px 14px",
                }}
              >
                <div style={{ fontSize: theme.fontSize.lg, color: theme.accent.primary, fontFamily: theme.font.ui, fontWeight: 700 }}>
                  {item.value}
                </div>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 4 }}>
                  {item.label}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{
          background: theme.bg.surface,
          border: "1px solid " + theme.border.default,
          borderRadius: theme.radius.xl,
          overflow: "hidden",
        }}>
          <button
            className="av-btn"
            onClick={function () { setShowConfigExplorer(function (prev) { return !prev; }); }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              padding: "12px 16px",
              background: "transparent",
              border: "none",
              color: theme.text.primary,
              cursor: "pointer",
              fontFamily: theme.font.ui,
              fontSize: theme.fontSize.md,
            }}
          >
            <span style={{ fontWeight: 600 }}>Project configuration</span>
            <span style={{ color: theme.text.dim, fontSize: theme.fontSize.base }}>
              {showConfigExplorer ? "collapse" : "expand"}
            </span>
          </button>

          {showConfigExplorer && (
            <div style={{ padding: "0 16px 16px" }}>
              {!configLoaded && (
                <div style={{ fontSize: theme.fontSize.base, color: theme.text.dim, fontFamily: theme.font.ui, padding: "8px 0" }}>
                  Detecting project configs...
                </div>
              )}
              {configLoaded && configFiles.length === 0 && (
                <div style={{ fontSize: theme.fontSize.base, color: theme.text.dim, fontFamily: theme.font.ui, padding: "8px 0" }}>
                  Start via CLI to detect project configs.
                </div>
              )}
              {configLoaded && configFiles.length > 0 && (function () {
                var format = metadata && metadata.format;
                var surfaces = getRelevantSurfaces(format);
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                    {surfaces.map(function (surface) {
                      var result = findConfigResult(surface.id);
                      var exists = Boolean(result && result.exists);
                      var preview = getSurfacePreview(result);
                      var isExpanded = expandedSurface === surface.id;
                      var fullContent = isExpanded ? getSurfaceFullContent(result) : null;

                      // Extract named items for skills and MCP surfaces
                      var namedItems = null;
                      if (exists && surface.type === "skills" && result) {
                        var skillNames = parseSkillNames(result);
                        if (skillNames.length > 0) namedItems = skillNames;
                      }
                      if (exists && surface.type === "mcp" && result) {
                        var serverNames = result.mcpServers || parseMcpServerNames(result.content);
                        if (serverNames.length > 0) namedItems = serverNames;
                      }

                      return (
                        <div
                          key={surface.id}
                          style={{
                            background: theme.bg.base,
                            border: "1px solid " + theme.border.subtle,
                            borderRadius: theme.radius.lg,
                            padding: "10px 12px",
                            cursor: exists ? "pointer" : "default",
                          }}
                          onClick={exists ? function () {
                            setExpandedSurface(function (prev) { return prev === surface.id ? null : surface.id; });
                          } : undefined}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontSize: theme.fontSize.base, color: theme.text.secondary, fontFamily: theme.font.mono }}>
                              {surface.label}
                            </span>
                            <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                              <span style={{
                                fontSize: theme.fontSize.xs,
                                color: exists ? theme.semantic.success : theme.text.dim,
                                background: exists ? alpha(theme.semantic.success, 0.1) : alpha(theme.text.dim, 0.1),
                                border: "1px solid " + (exists ? alpha(theme.semantic.success, 0.3) : alpha(theme.text.dim, 0.2)),
                                borderRadius: theme.radius.full,
                                padding: "2px 7px",
                              }}>
                                {exists ? "exists" : "not configured"}
                              </span>
                            </div>
                          </div>
                          {namedItems && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                              {namedItems.map(function (name) {
                                return (
                                  <span key={name} style={{
                                    fontSize: theme.fontSize.xs,
                                    color: theme.accent.primary,
                                    background: alpha(theme.accent.primary, 0.1),
                                    border: "1px solid " + alpha(theme.accent.primary, 0.25),
                                    borderRadius: theme.radius.full,
                                    padding: "1px 7px",
                                    fontFamily: theme.font.mono,
                                  }}>
                                    {name}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          {!namedItems && preview && (
                            <div style={{
                              fontSize: theme.fontSize.xs,
                              color: theme.text.muted,
                              marginTop: 5,
                              fontFamily: theme.font.mono,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}>
                              {preview}
                            </div>
                          )}
                          {isExpanded && fullContent && (
                            <div
                              style={{
                                marginTop: 8,
                                background: theme.bg.base,
                                border: "1px solid " + theme.border.default,
                                borderRadius: theme.radius.md,
                                padding: 10,
                                maxHeight: 200,
                                overflowY: "auto",
                                fontSize: theme.fontSize.xs,
                                fontFamily: theme.font.mono,
                                color: theme.text.secondary,
                                lineHeight: 1.6,
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                              }}
                              onClick={function (e) { e.stopPropagation(); }}
                            >
                              {fullContent}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {aiStatus === "loading" ? (
              <button
                className="av-btn"
                onClick={handleAiCancel}
                title="Cancel AI analysis"
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  border: "1px solid " + theme.border.default,
                  background: "transparent",
                  color: theme.text.muted,
                  borderRadius: theme.radius.md,
                  padding: "5px 10px",
                  fontSize: theme.fontSize.xs,
                  fontFamily: theme.font.ui,
                  cursor: "pointer",
                }}
              >
                <span>{"⏹"}</span>
                Cancel
              </button>
            ) : aiStatus === "done" ? (
              <button
                className="av-btn"
                onClick={handleAiRedo}
                title="Clear cache and re-run AI analysis"
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  border: "1px solid " + theme.border.default,
                  background: "transparent",
                  color: theme.text.secondary,
                  borderRadius: theme.radius.md,
                  padding: "5px 10px",
                  fontSize: theme.fontSize.xs,
                  fontFamily: theme.font.ui,
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: "0.9em" }}>{"↺"}</span>
                Redo
              </button>
            ) : aiStatus !== "loading" ? (
              <button
                className="av-btn"
                onClick={handleAiAnalyze}
                disabled={!rawSession}
                title="Analyze with GitHub Copilot SDK"
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  border: "1px solid " + theme.accent.primary,
                  background: alpha(theme.accent.primary, 0.08),
                  color: theme.accent.primary,
                  borderRadius: theme.radius.md,
                  padding: "5px 10px",
                  fontSize: theme.fontSize.xs,
                  fontFamily: theme.font.ui,
                  cursor: "pointer",
                }}
              >
                <span>{"✦"}</span>
                Analyze
              </button>
            ) : null}
          </div>
        </div>

        {aiStatus === "loading" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ background: alpha(theme.accent.primary, 0.04), border: "1px solid " + alpha(theme.accent.primary, 0.2), borderRadius: theme.radius.xl, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: theme.fontSize.xs, color: theme.accent.primary, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ animation: "spin 1.2s linear infinite", display: "inline-block" }}>{"✦"}</span>
                {progressStep ? progressStep.label : "Analyzing with Copilot SDK..."}
              </div>
              {liveRecs.length > 0 && (
                <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim }}>{liveRecs.length} rec{liveRecs.length !== 1 ? "s" : ""} so far</span>
              )}
            </div>
            {liveRecs.length > 0 && (
              <div style={{ background: alpha(theme.accent.primary, 0.05), border: "1px solid " + alpha(theme.accent.primary, 0.25), borderRadius: theme.radius.xl, padding: "14px 16px" }}>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.accent.primary, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>{"✦ AI recommendations"}</div>
                {liveRecs.map(function (rec, i) { return renderAiRecCard(rec, i, liveRecs.length); })}
              </div>
            )}
          </div>
        )}

        {aiStatus === "error" && (
          <div style={{ fontSize: theme.fontSize.xs, color: theme.semantic.error, background: theme.semantic.errorBg, border: "1px solid " + theme.semantic.errorBorder, borderRadius: theme.radius.lg, padding: "8px 12px" }}>
            AI analysis failed: {aiError}
          </div>
        )}

        {aiStatus === "done" && aiAnalysis && (
          <div style={{ background: alpha(theme.accent.primary, 0.05), border: "1px solid " + alpha(theme.accent.primary, 0.25), borderRadius: theme.radius.xl, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: theme.fontSize.xs, color: theme.accent.primary, textTransform: "uppercase", letterSpacing: 2 }}>
                {"✦ AI recommendations"}
              </div>
              {aiModelInfo && (
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim }}>
                  {aiModelInfo.model}
                  {aiModelInfo.usage ? " \u00b7 " + (aiModelInfo.usage.total_tokens || 0) + " tokens" : ""}
                </div>
              )}
            </div>
            {aiAnalysis.map(function (rec, i) { return renderAiRecCard(rec, i, aiAnalysis.length); })}
          </div>
        )}

      </div>
    </div>
  );
}
