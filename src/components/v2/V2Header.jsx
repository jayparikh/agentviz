import { useEffect, useRef, useState } from "react";
import { THEME_MODES, alpha, theme } from "../../lib/theme.js";
import BrandWordmark from "../ui/BrandWordmark.jsx";
import ExportStatusButton from "../ui/ExportStatusButton.jsx";
import Icon from "../Icon.jsx";
import ToolbarButton from "../ui/ToolbarButton.jsx";

function getStatus(session) {
  if (session && session.isLive) return { label: "Live", color: theme.semantic.success };
  if (session && session.events) return { label: "Ready", color: theme.text.secondary };
  return { label: "No session", color: theme.text.dim };
}

function formatZoneLabel(zone) {
  return String(zone || "find").charAt(0).toUpperCase() + String(zone || "find").slice(1);
}

function copyText(value) {
  if (!value || typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.writeText !== "function") return;
  navigator.clipboard.writeText(value).catch(function () {});
}

export default function V2Header({
  session,
  activeZone,
  currentThemeMode,
  onSetThemeMode,
  onOpenCommandPalette,
  onExportSession,
  exportSessionState,
  exportSessionError,
  onExitV2,
  compact,
}) {
  var [showThemeMenu, setShowThemeMenu] = useState(false);
  var themeMenuRef = useRef(null);
  var status = getStatus(session);
  var sessionName = session && session.file ? session.file : "Open or discover a session";
  var sourcePath = session && session.sourcePath ? session.sourcePath : null;
  var eventCount = session && session.metadata && session.metadata.totalEvents
    ? session.metadata.totalEvents + " events"
    : "No events";
  var zoneLabel = formatZoneLabel(activeZone);
  var currentTheme = THEME_MODES.find(function (item) { return item.id === currentThemeMode; }) || THEME_MODES[0];

  useEffect(function () {
    if (!showThemeMenu) return undefined;
    function handlePointerDown(event) {
      if (themeMenuRef.current && !themeMenuRef.current.contains(event.target)) setShowThemeMenu(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowThemeMenu(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return function () {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showThemeMenu]);

  return (
    <header style={{
      minHeight: 52,
      borderBottom: "1px solid " + theme.border.default,
      background: theme.bg.base,
      display: "flex",
      alignItems: "center",
      gap: theme.space.lg,
      padding: (compact ? theme.space.md : 0) + "px " + theme.space.xl + "px",
      flexShrink: 0,
      flexWrap: compact ? "wrap" : "nowrap",
    }}>
      <BrandWordmark style={{ fontSize: theme.fontSize.lg, flexShrink: 0 }} />

      <div style={{
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        flex: 1,
        flexBasis: compact ? "100%" : "auto",
        order: compact ? 2 : 0,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: theme.space.md,
          minWidth: 0,
        }}>
          <span style={{
            color: theme.text.primary,
            fontFamily: theme.font.mono,
            fontSize: theme.fontSize.md,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {sessionName}
          </span>
          {sourcePath && (
            <button
              type="button"
              className="av-btn"
              title={sourcePath}
              aria-label="Copy session source path"
              onClick={function () { copyText(sourcePath); }}
              style={{
                border: "1px solid " + theme.border.default,
                borderRadius: theme.radius.full,
                background: theme.bg.surface,
                color: theme.text.dim,
                fontFamily: theme.font.mono,
                fontSize: theme.fontSize.xs,
                padding: "1px 7px",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Path
            </button>
          )}
          <span aria-label={"Session status: " + status.label} style={{
            color: status.color,
            fontSize: theme.fontSize.xs,
            fontFamily: theme.font.mono,
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: theme.radius.full,
              background: status.color,
              display: "inline-block",
            }} />
            {status.label}
          </span>
        </div>
        {!compact && (
        <div style={{
          color: theme.text.dim,
          fontFamily: theme.font.mono,
          fontSize: theme.fontSize.xs,
        }}>
          {zoneLabel} · {eventCount}
        </div>
        )}
      </div>

      {onExportSession && (
        <ExportStatusButton
          state={exportSessionState}
          error={exportSessionError}
          onClick={onExportSession}
        />
      )}

      <ToolbarButton
        icon="command"
        onClick={onOpenCommandPalette}
        title="Command Palette (Cmd+K)"
        aria-label="Command palette"
      >
        {compact ? "Cmd" : "Cmd+K"}
      </ToolbarButton>

      {onSetThemeMode && (
        <div ref={themeMenuRef} style={{ position: "relative", flexShrink: 0 }}>
          <ToolbarButton
            onClick={function () { setShowThemeMenu(function (value) { return !value; }); }}
            title={"Theme: " + currentTheme.label + " (click to change)"}
            aria-label="Theme selector"
            aria-haspopup="menu"
            aria-expanded={showThemeMenu}
            style={{
              background: showThemeMenu ? alpha(theme.accent.primary, 0.08) : "transparent",
              borderColor: showThemeMenu ? theme.accent.primary : theme.border.default,
              color: showThemeMenu ? theme.accent.primary : theme.text.muted,
              padding: "2px 6px",
              minWidth: 28,
              justifyContent: "center",
            }}
          >
            <Icon name={currentTheme.icon} size={12} />
          </ToolbarButton>
          {showThemeMenu && (
            <div style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              background: theme.bg.surface,
              border: "1px solid " + theme.border.strong,
              borderRadius: theme.radius.lg,
              padding: 6,
              zIndex: theme.z.tooltip,
              boxShadow: theme.shadow.md,
              minWidth: 152,
            }}
            role="menu"
            aria-label="Theme mode"
            >
              {THEME_MODES.map(function (item) {
                var isSelected = item.id === currentThemeMode;
                return (
                  <button
                    key={item.id}
                    className="av-interactive"
                    type="button"
                    role="menuitemradio"
                    aria-checked={isSelected}
                    onClick={function () {
                      onSetThemeMode(item.id);
                      setShowThemeMenu(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      borderRadius: theme.radius.md,
                      width: "100%",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16 }}>
                      <Icon name={item.icon} size={12} style={{ color: isSelected ? theme.accent.primary : theme.text.secondary }} />
                    </span>
                    <span style={{
                      flex: 1,
                      fontSize: theme.fontSize.xs,
                      fontFamily: theme.font.mono,
                      color: theme.text.primary,
                    }}>
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {onExitV2 && (
        <ToolbarButton onClick={onExitV2} title="Switch to Classic UI">
          Classic UI
        </ToolbarButton>
      )}
    </header>
  );
}
