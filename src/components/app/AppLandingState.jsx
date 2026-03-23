import { theme } from "../../lib/theme.js";
import FileUploader from "../FileUploader.jsx";
import Icon from "../Icon.jsx";

export default function AppLandingState({ error, onLoad, onLoadSample, onStartCompare }) {
  return (
    <div style={{
      width: "100%",
      height: "100vh",
      background: theme.bg.base,
      color: theme.text.primary,
      fontFamily: theme.font.mono,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 24,
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <div style={{ fontSize: theme.fontSize.hero, fontWeight: 600, fontFamily: theme.font.ui, letterSpacing: "-0.5px", color: theme.text.primary }}>
          AGENTVIZ<span style={{ color: theme.accent.primary }}>.</span>
        </div>
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
    </div>
  );
}
