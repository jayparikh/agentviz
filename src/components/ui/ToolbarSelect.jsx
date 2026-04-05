import { useEffect, useRef, useState } from "react";
import { theme } from "../../lib/theme.js";
import Icon from "../Icon.jsx";

export default function ToolbarSelect({ ariaLabel, value, onChange, options, minWidth, menuWidth }) {
  var [open, setOpen] = useState(false);
  var ref = useRef(null);
  var triggerRef = useRef(null);
  var listboxId = useRef("toolbar-select-" + Math.random().toString(36).slice(2));
  var selected = options.find(function (option) { return option.id === value; });

  useEffect(function () {
    if (!open) return;
    function handleClick(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      if (triggerRef.current) triggerRef.current.focus();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return function () {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        ref={triggerRef}
        type="button"
        className="av-btn"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId.current}
        onClick={function () { setOpen(function (current) { return !current; }); }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: theme.bg.base,
          color: theme.text.muted,
          border: "1px solid " + theme.border.default,
          borderRadius: theme.radius.md,
          padding: "5px 10px",
          fontSize: theme.fontSize.xs,
          fontFamily: theme.font.mono,
          cursor: "pointer",
          minWidth: minWidth || 120,
        }}
      >
        <span style={{ flex: 1, textAlign: "left" }}>{selected ? selected.label : ""}</span>
        <Icon name="chevron-down" size={10} style={{ opacity: 0.5 }} />
      </button>
      {open && (
        <div
          id={listboxId.current}
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            background: theme.bg.surface,
            border: "1px solid " + theme.border.strong,
            borderRadius: theme.radius.lg,
            padding: 4,
            zIndex: theme.z.tooltip,
            boxShadow: theme.shadow.md,
            minWidth: menuWidth || 180,
          }}
        >
          {options.map(function (option) {
            var isActive = option.id === value;
            return (
              <button
                type="button"
                key={option.id}
                className="av-interactive"
                role="option"
                aria-selected={isActive}
                onClick={function () { onChange(option.id); setOpen(false); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "5px 10px",
                  borderRadius: theme.radius.md,
                  background: isActive ? theme.bg.raised : "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: theme.fontSize.xs,
                  fontFamily: theme.font.mono,
                  color: isActive ? theme.accent.primary : theme.text.secondary,
                }}
              >
                <span style={{ width: 12, textAlign: "center", fontSize: theme.fontSize.xs }}>
                  {isActive ? "\u2713" : ""}
                </span>
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
