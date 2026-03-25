import { useCallback, useEffect, useState } from "react";
import { theme, alpha } from "../../lib/theme.js";
import FileUploader from "../FileUploader.jsx";
import Icon from "../Icon.jsx";
import BrandWordmark from "../ui/BrandWordmark.jsx";
import ShellFrame from "../ui/ShellFrame.jsx";

var SOURCE_COLORS = {
  claude: theme.agent.assistant,
  copilot: theme.track.context,
};

function formatRecentTime(item) {
  var value = item && (item.mtimeMs || item.mtimeIso);
  if (!value) return "time unknown";
  var ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return "time unknown";
  return ts.toLocaleString();
}

function getPathContext(item) {
  if (!item || !item.path) return "";
  var parts = String(item.path).split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return item.path;
  return parts.slice(-3).join("/");
}

function formatCount(value, label) {
  if (!Number.isFinite(value)) return "unknown " + label;
  var n = Math.max(0, Math.floor(value));
  return n.toLocaleString() + " " + label;
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "unknown size";
  var size = Math.max(0, bytes);
  if (size < 1024) return size + " B";
  var kb = size / 1024;
  if (kb < 1024) return kb.toFixed(1) + " KB";
  var mb = kb / 1024;
  return mb.toFixed(1) + " MB";
}

export default function AppLandingState({ error, onLoad, onLoadRecent, onLoadSample, onStartCompare }) {
  var [recent, setRecent] = useState([]);
  var [isLoadingRecent, setIsLoadingRecent] = useState(false);
  var [recentError, setRecentError] = useState(null);
  var [showRecentModal, setShowRecentModal] = useState(false);

  var loadRecentSessions = useCallback(function () {
    setIsLoadingRecent(true);
    setRecentError(null);

    fetch("/api/sessions?limit=20")
      .then(function (r) {
        if (!r.ok) throw new Error("failed");
        return r.json();
      })
      .then(function (payload) {
        var sessions = payload && Array.isArray(payload.sessions) ? payload.sessions : [];
        setRecent(sessions);
        setIsLoadingRecent(false);
      })
      .catch(function () {
        setRecent([]);
        setIsLoadingRecent(false);
        setRecentError("Could not fetch local sessions. Start the app with node bin/agentviz.js.");
      });
  }, []);

  useEffect(function () {
    if (!showRecentModal) return;
    loadRecentSessions();
  }, [showRecentModal, loadRecentSessions]);

  useEffect(function () {
    if (!showRecentModal) return;

    function onKeyDown(e) {
      if (e.key === "Escape") setShowRecentModal(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return function () {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showRecentModal]);



  return (
    <ShellFrame
      style={{
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        position: "relative",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <BrandWordmark style={{ fontSize: theme.fontSize.hero }} />
        <div style={{ fontSize: theme.fontSize.md, color: theme.text.dim, marginTop: 6, lineHeight: 1.6 }}>
          See what your AI agents actually do.
        </div>
      </div>

      <FileUploader onLoad={onLoad} />

      {error && (
        <div style={{
          background: theme.semantic.errorBg,
          border: "1px solid " + theme.semantic.error,
          borderRadius: theme.radius.xl,
          padding: "10px 16px",
          fontSize: theme.fontSize.md,
          color: theme.semantic.errorText,
          maxWidth: 500,
          animation: "fadeIn 0.3s ease",
        }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <span onClick={onLoadSample} style={{ color: theme.text.muted, cursor: "pointer", fontSize: theme.fontSize.sm }}>
          load a demo session
        </span>
        <span style={{ color: theme.text.ghost, fontSize: theme.fontSize.sm }}>or</span>
        <span
          onClick={function () { setShowRecentModal(true); }}
          style={{
            color: theme.text.muted,
            cursor: "pointer",
            fontSize: theme.fontSize.sm,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <Icon name="file-plus" size={12} /> browse local sessions
        </span>
        <span style={{ color: theme.text.ghost, fontSize: theme.fontSize.sm }}>or</span>
        <span
          onClick={onStartCompare}
          style={{
            color: theme.accent.primary,
            cursor: "pointer",
            fontSize: theme.fontSize.sm,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <Icon name="arrow-up-down" size={12} /> compare two sessions
        </span>
      </div>

      {showRecentModal && (
        <div
          onClick={function () { setShowRecentModal(false); }}
          style={{
            position: "fixed",
            inset: 0,
            background: theme.bg.overlay,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: theme.z.modal,
            padding: 24,
          }}
        >
          <div
            onClick={function (e) { e.stopPropagation(); }}
            style={{
              width: "min(920px, 100%)",
              maxHeight: "min(80vh, 760px)",
              background: theme.bg.raised,
              border: "1px solid " + theme.border.strong,
              borderRadius: theme.radius.xxl,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: theme.shadow.lg,
            }}
          >
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 16px",
              borderBottom: "1px solid " + theme.border.default,
              background: theme.bg.surface,
            }}>
              <div>
                <div style={{ fontSize: theme.fontSize.lg, color: theme.text.primary, fontWeight: 600 }}>
                  Recent local sessions
                </div>
                <div style={{ fontSize: theme.fontSize.sm, color: theme.text.dim, marginTop: 4 }}>
                  Claude Code and Copilot CLI files from known local session folders
                </div>
              </div>
              <button
                onClick={function () { setShowRecentModal(false); }}
                style={{
                  background: "transparent",
                  color: theme.text.muted,
                  border: "1px solid " + theme.border.default,
                  borderRadius: theme.radius.lg,
                  cursor: "pointer",
                  padding: "7px 10px",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Icon name="close" size={14} />
              </button>
            </div>

            <div style={{ padding: 12, overflowY: "auto", minHeight: 260 }}>
              {isLoadingRecent && (
                <div style={{ fontSize: theme.fontSize.sm, color: theme.text.dim, padding: 10 }}>
                  Scanning local session directories...
                </div>
              )}

              {!isLoadingRecent && recentError && (
                <div style={{
                  background: theme.semantic.errorBg,
                  border: "1px solid " + theme.semantic.error,
                  borderRadius: theme.radius.lg,
                  padding: "10px 12px",
                  color: theme.semantic.errorText,
                  fontSize: theme.fontSize.sm,
                }}>
                  {recentError}
                </div>
              )}

              {!isLoadingRecent && !recentError && recent.length === 0 && (
                <div style={{ fontSize: theme.fontSize.sm, color: theme.text.dim, padding: 10 }}>
                  No known local sessions were found yet.
                </div>
              )}

              {!isLoadingRecent && !recentError && recent.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {recent.map(function (item, idx) {
                    return (
                      <button
                        key={item.path + "-" + idx}
                        onClick={function () {
                          setShowRecentModal(false);
                          onLoadRecent(item.path);
                        }}
                        style={{
                          width: "100%",
                          border: "1px solid " + theme.border.default,
                          borderRadius: theme.radius.lg,
                          background: theme.bg.surface,
                          color: theme.text.primary,
                          textAlign: "left",
                          cursor: "pointer",
                          padding: "11px 12px",
                          fontFamily: theme.font.mono,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                          <span style={{ fontSize: theme.fontSize.md, fontWeight: 600 }}>{item.name}</span>
                          <span style={{
                            fontSize: theme.fontSize.xs,
                            color: SOURCE_COLORS[item.sourceKind] || theme.text.secondary,
                            border: "1px solid " + alpha(SOURCE_COLORS[item.sourceKind] || theme.border.subtle, 0.25),
                            borderRadius: theme.radius.full,
                            padding: "2px 8px",
                            flexShrink: 0,
                            background: alpha(SOURCE_COLORS[item.sourceKind] || theme.bg.base, 0.08),
                          }}>
                            {item.sourceLabel || item.sourceKind}
                          </span>
                        </div>
                        <div style={{ marginTop: 7, fontSize: theme.fontSize.xs, color: theme.text.secondary }}>
                          Modified: {formatRecentTime(item)}
                        </div>
                        <div style={{ marginTop: 5, fontSize: theme.fontSize.sm, color: theme.text.secondary }}>
                          {formatCount(item.eventCount, "events")} | {formatSize(item.sizeBytes)}
                        </div>
                        <div style={{ marginTop: 5, fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                          {getPathContext(item)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </ShellFrame>
  );
}
