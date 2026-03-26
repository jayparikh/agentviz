import { theme } from "../../lib/theme.js";
import Icon from "../Icon.jsx";

export default function ToolbarButton({
  children,
  icon,
  iconSize,
  disabled,
  onClick,
  title,
  style,
  type,
  "aria-label": ariaLabel,
}) {
  return (
    <button
      type={type || "button"}
      className="av-btn"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      style={Object.assign({
        background: "transparent",
        border: "1px solid " + theme.border.default,
        borderRadius: theme.radius.md,
        color: theme.text.muted,
        padding: "2px 8px",
        fontSize: theme.fontSize.sm,
        fontFamily: theme.font.ui,
        display: "flex",
        alignItems: "center",
        gap: 4,
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? "default" : "pointer",
      }, style)}
    >
      {icon && <Icon name={icon} size={iconSize || 12} />}
      {children}
    </button>
  );
}
