import { useState } from "react";
import { TRACK_TYPES, alpha, theme } from "../../lib/theme.js";
import LiveIndicator from "../LiveIndicator.jsx";
import Icon from "../Icon.jsx";
import BrandWordmark from "../ui/BrandWordmark.jsx";
import ExportStatusButton from "../ui/ExportStatusButton.jsx";
import ToolbarButton from "../ui/ToolbarButton.jsx";
import RecentSessionsPicker from "../RecentSessionsPicker.jsx";

export default function AppHeader({
  session,
  activeView,
  views,
  onSetView,
  onReset,
  search,
  searchInputRef,
  onJumpToMatch,
  onShowPalette,
  errorEntries,
  onJumpToError,
  filtersRef,
  showFilters,
  onToggleFilters,
  activeFilterCount,
  trackFilters,
  onToggleTrackFilter,
  speed,
  onCycleSpeed,
  onStartCompare,
  hasRawText,
  onExportSession,
  exportSessionState,
  exportSessionError,
  recentSessions,
  onOpenRecentSession,
  currentFile,
}) {
  var [showRecent, setShowRecent] = useState(false);

  var showSearch = activeView === "replay" || activeView === "tracks" || activeView === "waterfall";
  var showFiltersBtn = activeView === "replay" || activeView === "tracks" || activeView === "waterfall";
  var showSpeed = activeView === "replay" || activeView === "tracks" || activeView === "waterfall";
  var showErrorNav = activeView === "replay";

  return (
    <div style={{
      padding: "8px 16px",
      display: "flex",
      alignItems: "center",
      gap: 8,
      borderBottom: "1px solid " + theme.border.default,
      flexShrink: 0,
      minWidth: 0,
      height: 44,
      boxSizing: "border-box",
      position: "relative",
      zIndex: theme.z.active,
    }}>
      <BrandWordmark onClick={onReset} title="Back to start" style={{ flexShrink: 0, fontSize: theme.fontSize.xl }} />
      <div style={{ height: 16, width: 1, background: theme.border.default, flexShrink: 0 }} />
      <span style={{
        fontSize: theme.fontSize.base,
        color: theme.text.secondary,
        fontFamily: theme.font.mono,
        maxWidth: 140,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flexShrink: 1,
      }}>
        {session.file}
      </span>
      {session.isLive && <LiveIndicator />}
      {session.metadata && (
        <span style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, display: "flex", alignItems: "center", gap: 4, flexShrink: 0, whiteSpace: "nowrap" }}>
          {session.metadata.totalEvents} events
          {session.metadata.errorCount > 0 && (
            <span style={{ color: theme.semantic.error, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Icon name="alert-circle" size={12} /> {session.metadata.errorCount}
            </span>
          )}
        </span>
      )}

      <div style={{
        display: "flex",
        gap: 2,
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        background: theme.bg.surface,
        borderRadius: theme.radius.lg,
        padding: 2,
        flexShrink: 0,
      }}>
        {views.map(function (item) {
          var isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              className="av-btn"
              onClick={function () { onSetView(item.id); }}
              style={{
                background: isActive ? theme.bg.raised : "transparent",
                border: "none",
                borderRadius: theme.radius.md,
                color: isActive ? theme.accent.primary : theme.text.muted,
                padding: "4px 8px",
                fontSize: theme.fontSize.sm,
                fontFamily: theme.font.ui,
                display: "flex",
                alignItems: "center",
                gap: 4,
                whiteSpace: "nowrap",
              }}
            >
              <Icon name={item.icon} size={13} style={{ opacity: isActive ? 1 : 0.6 }} /> {item.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, marginLeft: "auto" }}>
        {showSearch && (
          <div className="av-search-wrap" style={{ display: "flex", alignItems: "center", gap: 6, position: "relative", background: theme.bg.base, border: "1px solid " + theme.border.default, borderRadius: theme.radius.md, padding: "4px 8px", transition: "border-color 150ms ease-out" }}>
            <Icon name="search" size={13} style={{ color: theme.text.dim, flexShrink: 0 }} />
            <input
              ref={searchInputRef}
              id="agentviz-search"
              className="av-search"
              type="text"
              value={search.searchInput}
              onChange={function (e) { search.setSearchInput(e.target.value); }}
              onKeyDown={function (e) {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onJumpToMatch(e.shiftKey ? "prev" : "next");
                }
                if (e.key === "Escape") {
                  e.target.blur();
                  search.clearSearch();
                }
              }}
              placeholder="Search (/)"
              style={{
                background: "transparent",
                border: "none",
                color: theme.text.primary,
                padding: "2px 0",
                fontSize: theme.fontSize.sm,
                fontFamily: theme.font.mono,
                width: 100,
                outline: "none",
              }}
            />
            {search.searchResults && (
              <span style={{
                fontSize: theme.fontSize.sm,
                color: search.searchResults.length > 0 ? theme.accent.primary : theme.semantic.error,
              }}>
                {search.searchResults.length}
              </span>
            )}
          </div>
        )}

        <ToolbarButton onClick={onShowPalette} title="Command Palette (Cmd+K)" aria-label="Command palette" style={{ padding: "2px 6px", color: theme.text.dim, fontSize: theme.fontSize.xs }}>
          <Icon name="command" size={11} />
        </ToolbarButton>

        {showErrorNav && errorEntries.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <ToolbarButton
              onClick={function () { onJumpToError("prev"); }}
              title="Previous error (Shift+E)"
              aria-label="Previous error"
              style={{
                border: "1px solid " + theme.semantic.errorBorder,
                borderRadius: theme.radius.sm,
                color: theme.semantic.error,
                padding: "2px 4px",
                fontSize: theme.fontSize.sm,
              }}
            >
              <Icon name="chevron-left" size={12} />
            </ToolbarButton>
            <span style={{ fontSize: theme.fontSize.sm, color: theme.semantic.error, display: "flex", alignItems: "center", gap: 4 }}>
              <Icon name="alert-circle" size={12} /> {errorEntries.length}
            </span>
            <ToolbarButton
              onClick={function () { onJumpToError("next"); }}
              title="Next error (E)"
              aria-label="Next error"
              style={{
                border: "1px solid " + theme.semantic.errorBorder,
                borderRadius: theme.radius.sm,
                color: theme.semantic.error,
                padding: "2px 4px",
                fontSize: theme.fontSize.sm,
              }}
            >
              <Icon name="chevron-right" size={12} />
            </ToolbarButton>
          </div>
        )}

        {(showSearch || showFiltersBtn) && (
          <div style={{ height: 12, width: 1, background: theme.border.default }} />
        )}

        {showFiltersBtn && (
          <div ref={filtersRef} style={{ position: "relative" }}>
            <ToolbarButton
              onClick={onToggleFilters}
              title="Filter tracks"
              aria-label="Filter tracks"
              style={{
                background: activeFilterCount > 0 ? alpha(theme.accent.primary, 0.08) : "transparent",
                border: "1px solid " + (activeFilterCount > 0 ? theme.accent.primary : theme.border.default),
                color: activeFilterCount > 0 ? theme.accent.primary : theme.text.muted,
              }}
            >
              <Icon name="filter" size={12} />
              {activeFilterCount > 0 && <span style={{ fontSize: theme.fontSize.xs }}>{activeFilterCount}</span>}
            </ToolbarButton>
            {showFilters && (
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
                minWidth: 160,
              }}>
                {Object.entries(TRACK_TYPES).map(function (entry) {
                  var key = entry[0];
                  var info = entry[1];
                  var isHidden = trackFilters[key];
                  return (
                    <button
                      key={key}
                      className="av-interactive"
                      onClick={function () { onToggleTrackFilter(key); }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "4px 10px",
                        borderRadius: theme.radius.md,
                        width: "100%",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <Icon name={key} size={12} style={{ color: isHidden ? theme.text.ghost : info.color }} />
                      <span style={{
                        fontSize: theme.fontSize.xs,
                        fontFamily: theme.font.mono,
                        color: isHidden ? theme.text.ghost : theme.text.secondary,
                        textDecoration: isHidden ? "line-through" : "none",
                        flex: 1,
                      }}>
                        {info.label}
                      </span>
                      {isHidden && (
                        <span style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost, fontFamily: theme.font.mono }}>hidden</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {showSpeed && (
          <ToolbarButton
            onClick={onCycleSpeed}
            title="Playback speed (click to cycle)"
            style={{
              background: speed !== 1 ? alpha(theme.accent.primary, 0.08) : "transparent",
              border: "1px solid " + (speed !== 1 ? theme.accent.primary : theme.border.default),
              color: speed !== 1 ? theme.accent.primary : theme.text.muted,
            }}
          >
            {speed}x
          </ToolbarButton>
        )}

        <ToolbarButton onClick={onStartCompare} title="Compare with another session" aria-label="Compare with another session" style={{ padding: "2px 6px" }}>
          <Icon name="arrow-up-down" size={12} />
        </ToolbarButton>

        {onOpenRecentSession && recentSessions && (
          <div style={{ position: "relative" }}>
            <ToolbarButton
              onClick={function () { setShowRecent(function (v) { return !v; }); }}
              title="Recent sessions"
              aria-label="Recent sessions"
              style={{
                background: showRecent ? alpha(theme.accent.primary, 0.08) : "transparent",
                border: "1px solid " + (showRecent ? theme.accent.primary : theme.border.default),
                color: showRecent ? theme.accent.primary : theme.text.muted,
                padding: "2px 6px",
              }}
            >
              <Icon name="clock" size={12} />
            </ToolbarButton>
            {showRecent && (
              <RecentSessionsPicker
                entries={recentSessions}
                currentFile={currentFile}
                onOpen={function (entry) {
                  setShowRecent(false);
                  onOpenRecentSession(entry);
                }}
                onClose={function () { setShowRecent(false); }}
              />
            )}
          </div>
        )}

        {hasRawText && (
          <ExportStatusButton
            state={exportSessionState}
            error={exportSessionError}
            onClick={onExportSession}
          />
        )}

        <ToolbarButton onClick={onReset} title="Close session" aria-label="Close session" style={{ padding: "2px 6px" }}>
          <Icon name="close" size={12} />
        </ToolbarButton>
      </div>
    </div>
  );
}
