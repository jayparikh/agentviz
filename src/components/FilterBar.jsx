import { useState } from "react";
import { theme, alpha } from "../lib/theme.js";
import Icon from "./Icon.jsx";

function MultiSelect({ label, options, selected, onToggle }) {
  var [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button
        className="av-interactive"
        onClick={function () { setOpen(function (v) { return !v; }); }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 8px",
          borderRadius: theme.radius.md,
          border: "1px solid " + (selected.length > 0 ? theme.accent.primary : theme.border.default),
          background: selected.length > 0 ? alpha(theme.accent.primary, 0.08) : theme.bg.surface,
          color: selected.length > 0 ? theme.accent.primary : theme.text.secondary,
          fontSize: theme.fontSize.xs,
          fontFamily: theme.font.mono,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {label}
        {selected.length > 0 && (
          <span style={{
            background: theme.accent.primary,
            color: theme.bg.surface,
            borderRadius: theme.radius.full,
            padding: "0 5px",
            fontSize: theme.fontSize.xs,
            lineHeight: "16px",
            minWidth: 16,
            textAlign: "center",
          }}>
            {selected.length}
          </span>
        )}
        <Icon name="chevron-down" size={10} />
      </button>
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          background: theme.bg.surface,
          border: "1px solid " + theme.border.strong,
          borderRadius: theme.radius.lg,
          padding: 4,
          zIndex: theme.z.tooltip,
          boxShadow: theme.shadow.md,
          maxHeight: 240,
          overflowY: "auto",
          minWidth: 160,
        }}>
          {options.map(function (option) {
            var isSelected = selected.indexOf(option) !== -1;
            return (
              <button
                key={option}
                className="av-interactive"
                onClick={function () { onToggle(option); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 8px",
                  borderRadius: theme.radius.sm,
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{
                  width: 14,
                  height: 14,
                  borderRadius: theme.radius.sm,
                  border: "1px solid " + (isSelected ? theme.accent.primary : theme.border.default),
                  background: isSelected ? theme.accent.primary : "transparent",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {isSelected && <Icon name="check" size={10} style={{ color: "#fff" }} />}
                </span>
                <span style={{
                  fontSize: theme.fontSize.xs,
                  fontFamily: theme.font.mono,
                  color: theme.text.primary,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {option}
                </span>
              </button>
            );
          })}
          {options.length === 0 && (
            <span style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, padding: "4px 8px" }}>
              None available
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function FilterBar({
  toolNameFilter,
  onToggleToolName,
  agentFilter,
  onToggleAgent,
  errorsOnly,
  onToggleErrorsOnly,
  uniqueToolNames,
  uniqueAgents,
  onClearAll,
  activeCount,
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "4px 16px",
      borderBottom: "1px solid " + theme.border.subtle,
      background: theme.bg.base,
      flexShrink: 0,
    }}>
      <span style={{
        fontSize: theme.fontSize.xs,
        color: theme.text.dim,
        fontFamily: theme.font.ui,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        flexShrink: 0,
      }}>
        Filters
      </span>

      <MultiSelect
        label="Tool"
        options={uniqueToolNames}
        selected={toolNameFilter}
        onToggle={onToggleToolName}
      />

      <MultiSelect
        label="Agent"
        options={uniqueAgents}
        selected={agentFilter}
        onToggle={onToggleAgent}
      />

      <button
        className="av-interactive"
        onClick={onToggleErrorsOnly}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 8px",
          borderRadius: theme.radius.md,
          border: "1px solid " + (errorsOnly ? theme.semantic.error : theme.border.default),
          background: errorsOnly ? theme.semantic.errorBg : theme.bg.surface,
          color: errorsOnly ? theme.semantic.error : theme.text.secondary,
          fontSize: theme.fontSize.xs,
          fontFamily: theme.font.mono,
          cursor: "pointer",
        }}
      >
        <Icon name="alert-circle" size={11} />
        Errors only
      </button>

      {activeCount > 0 && (
        <button
          className="av-interactive"
          onClick={onClearAll}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 8px",
            borderRadius: theme.radius.md,
            border: "1px solid " + theme.border.default,
            background: "transparent",
            color: theme.text.muted,
            fontSize: theme.fontSize.xs,
            fontFamily: theme.font.mono,
            cursor: "pointer",
          }}
        >
          <Icon name="close" size={10} />
          Clear all
        </button>
      )}
    </div>
  );
}
