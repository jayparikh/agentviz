import { alpha, theme } from "../../lib/theme.js";
import ToolbarButton from "./ToolbarButton.jsx";

export default function ExportStatusButton({
  state,
  error,
  onClick,
  padding,
  label = "Export",
  title = "Export as self-contained HTML",
}) {
  return (
    <ToolbarButton
      icon="download"
      iconSize={12}
      onClick={onClick}
      disabled={state === "loading"}
      title={state === "error" ? error : title}
      style={{
        background: state === "done" ? alpha(theme.semantic.success, 0.1)
          : state === "error" ? alpha(theme.semantic.error, 0.1)
          : "transparent",
        borderColor: state === "done" ? theme.semantic.success
          : state === "error" ? theme.semantic.error
          : theme.border.default,
        color: state === "done" ? theme.semantic.success
          : state === "error" ? theme.semantic.error
          : theme.text.muted,
        padding: padding || "2px 8px",
      }}
    >
      {state === "loading" ? "Exporting..."
        : state === "done" ? "Exported!"
        : state === "error" ? "Failed"
        : label}
    </ToolbarButton>
  );
}
