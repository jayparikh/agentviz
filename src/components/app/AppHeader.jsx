import { TRACK_TYPES, alpha, theme } from "../../lib/theme.js";
import LiveIndicator from "../LiveIndicator.jsx";
import Icon from "../Icon.jsx";

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
}) {
  return (
    <div style={{
      padding: "8px 16px",
      display: "flex",
      alignItems: "center",
      gap: 10,
      borderBottom: "1px solid " + theme.border.default,
      flexShrink: 0,
    }}>
      <span
        className="av-btn"
        onClick={onReset}
        title="Back to start"
        style={{
          fontSize: theme.fontSize.lg,
          fontWeight: 600,
          fontFamily: theme.font.ui,
          letterSpacing: "-0.5px",
          color: theme.text.primary,
          padding: "2px 4px",
          borderRadius: theme.radius.sm,
          background: "transparent",
          border: "none",
        }}
      >
        AGENTVIZ<span style={{ color: theme.accent.primary }}>.</span>
      </span>
      <div style={{ height: 16, width: 1, background: theme.border.default }} />
      <span style={{
        fontSize: theme.fontSize.base,
        color: theme.text.muted,
        fontFamily: theme.font.mono,
        maxWidth: 160,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {session.file}
      </span>
      {session.isLive && <LiveIndicator />}
      {session.metadata && (
        <span style={{ fontSize: theme.fontSize.sm, color: theme.text.ghost, display: "flex", alignItems: "center", gap: 6 }}>
          {session.metadata.totalEvents} events
          {session.metadata.errorCount > 0 && (
            <span style={{ color: theme.semantic.error, display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Icon name="alert-circle" size={12} /> {session.metadata.errorCount}
            </span>
          )}
        </span>
      )}

      <div style={{
        display: "flex",
        gap: 2,
        margin: "0 auto",
        background: theme.bg.surface,
        borderRadius: theme.radius.lg,
        padding: 2,
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
                padding: "4px 12px",
                fontSize: theme.fontSize.base,
                fontFamily: theme.font.ui,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Icon name={item.icon} size={13} style={{ opacity: isActive ? 1 : 0.6 }} /> {item.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
          <Icon name="search" size={13} style={{ color: theme.text.dim }} />
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
              background: theme.bg.surface,
              border: "1px solid " + theme.border.default,
              borderRadius: theme.radius.md,
              color: theme.text.primary,
              padding: "3px 8px",
              fontSize: theme.fontSize.base,
              fontFamily: theme.font.mono,
              width: 120,
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

        <button
          className="av-btn"
          onClick={onShowPalette}
          title="Command Palette (Cmd+K)"
          style={{
            background: theme.bg.surface,
            border: "1px solid " + theme.border.default,
            borderRadius: theme.radius.md,
            color: theme.text.dim,
            padding: "2px 8px",
            fontSize: theme.fontSize.xs,
            fontFamily: theme.font.ui,
            display: "flex",
            alignItems: "center",
            gap: 3,
          }}
        >
          <Icon name="command" size={11} />K
        </button>

        {errorEntries.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <button
              className="av-btn"
              onClick={function () { onJumpToError("prev"); }}
              title="Previous error (Shift+E)"
              style={{
                background: "transparent",
                border: "1px solid " + theme.semantic.errorBorder,
                borderRadius: theme.radius.sm,
                color: theme.semantic.error,
                padding: "2px 4px",
                fontSize: theme.fontSize.sm,
                display: "flex",
                alignItems: "center",
              }}
            >
              <Icon name="chevron-left" size={12} />
            </button>
            <span style={{ fontSize: theme.fontSize.sm, color: theme.semantic.error, display: "flex", alignItems: "center", gap: 3 }}>
              <Icon name="alert-circle" size={12} /> {errorEntries.length}
            </span>
            <button
              className="av-btn"
              onClick={function () { onJumpToError("next"); }}
              title="Next error (E)"
              style={{
                background: "transparent",
                border: "1px solid " + theme.semantic.errorBorder,
                borderRadius: theme.radius.sm,
                color: theme.semantic.error,
                padding: "2px 4px",
                fontSize: theme.fontSize.sm,
                display: "flex",
                alignItems: "center",
              }}
            >
              <Icon name="chevron-right" size={12} />
            </button>
          </div>
        )}

        <div style={{ height: 12, width: 1, background: theme.border.default }} />

        <div ref={filtersRef} style={{ position: "relative" }}>
          <button
            className="av-btn"
            onClick={onToggleFilters}
            title="Filter tracks"
            style={{
              background: activeFilterCount > 0 ? alpha(theme.accent.primary, 0.08) : "transparent",
              border: "1px solid " + (activeFilterCount > 0 ? theme.accent.primary : theme.border.default),
              borderRadius: theme.radius.md,
              color: activeFilterCount > 0 ? theme.accent.primary : theme.text.muted,
              padding: "2px 8px",
              fontSize: theme.fontSize.sm,
              fontFamily: theme.font.ui,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Icon name="filter" size={12} />
            {activeFilterCount > 0 ? activeFilterCount + " hidden" : "Filters"}
          </button>
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
                      padding: "6px 10px",
                      borderRadius: theme.radius.md,
                      width: "100%",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <Icon name={key} size={13} style={{ color: isHidden ? theme.text.ghost : info.color }} />
                    <span style={{
                      fontSize: theme.fontSize.base,
                      fontFamily: theme.font.ui,
                      color: isHidden ? theme.text.ghost : theme.text.secondary,
                      textDecoration: isHidden ? "line-through" : "none",
                      flex: 1,
                    }}>
                      {info.label}
                    </span>
                    {isHidden && (
                      <span style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost }}>hidden</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          className="av-btn"
          onClick={onCycleSpeed}
          title="Playback speed (click to cycle)"
          style={{
            background: speed !== 1 ? alpha(theme.accent.primary, 0.08) : "transparent",
            border: "1px solid " + (speed !== 1 ? theme.accent.primary : theme.border.default),
            color: speed !== 1 ? theme.accent.primary : theme.text.muted,
            borderRadius: theme.radius.md,
            padding: "2px 8px",
            fontSize: theme.fontSize.sm,
            fontFamily: theme.font.ui,
          }}
        >
          {speed}x
        </button>

        <button
          className="av-btn"
          onClick={onStartCompare}
          title="Compare with another session"
          style={{
            background: "transparent",
            border: "1px solid " + theme.border.default,
            color: theme.text.muted,
            borderRadius: theme.radius.md,
            padding: "2px 8px",
            fontSize: theme.fontSize.sm,
            fontFamily: theme.font.ui,
          }}
        >
          Compare
        </button>

        {hasRawText && (
          <button
            className="av-btn"
            onClick={onExportSession}
            disabled={exportSessionState === "loading"}
            title={exportSessionState === "error" ? exportSessionError : "Export as self-contained HTML"}
            style={{
              background: exportSessionState === "done" ? alpha(theme.semantic.success, 0.1)
                : exportSessionState === "error" ? alpha(theme.semantic.error, 0.1)
                : "transparent",
              border: "1px solid " + (
                exportSessionState === "done" ? theme.semantic.success
                : exportSessionState === "error" ? theme.semantic.error
                : theme.border.default
              ),
              color: exportSessionState === "done" ? theme.semantic.success
                : exportSessionState === "error" ? theme.semantic.error
                : theme.text.muted,
              borderRadius: theme.radius.md,
              padding: "2px 8px",
              fontSize: theme.fontSize.sm,
              fontFamily: theme.font.ui,
              display: "flex",
              alignItems: "center",
              gap: 4,
              opacity: exportSessionState === "loading" ? 0.6 : 1,
              cursor: exportSessionState === "loading" ? "default" : "pointer",
            }}
          >
            <Icon name="download" size={12} />
            {exportSessionState === "loading" ? "Exporting..."
              : exportSessionState === "done" ? "Exported!"
              : exportSessionState === "error" ? "Failed"
              : "Export"}
          </button>
        )}

        <button
          className="av-btn"
          onClick={onReset}
          title="Close session"
          style={{
            background: "transparent",
            border: "1px solid " + theme.border.default,
            color: theme.text.muted,
            borderRadius: theme.radius.md,
            padding: "2px 6px",
            fontSize: theme.fontSize.sm,
            fontFamily: theme.font.ui,
            display: "flex",
            alignItems: "center",
            gap: 3,
          }}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  );
}
