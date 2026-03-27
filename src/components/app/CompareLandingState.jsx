import { alpha, theme } from "../../lib/theme.js";
import FileUploader from "../FileUploader.jsx";
import BrandWordmark from "../ui/BrandWordmark.jsx";
import ShellFrame from "../ui/ShellFrame.jsx";

export default function CompareLandingState({ session, sessionB, onLoadSessionA, onExitCompare }) {
  return (
    <ShellFrame
      style={{
        alignItems: "center",
        justifyContent: "center",
        gap: 32,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <BrandWordmark style={{ fontSize: theme.fontSize.hero }} />
        <div style={{ fontSize: theme.fontSize.md, color: theme.text.secondary, marginTop: 6 }}>
          Compare two agent sessions head to head.
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", width: "100%", maxWidth: 900, padding: "0 24px" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: theme.fontSize.sm, color: theme.accent.light, fontFamily: theme.font.ui, letterSpacing: 1, textTransform: "uppercase" }}>
            Session A
          </div>
          {session.events ? (
            <div style={{
              border: "1px solid " + theme.semantic.success,
              borderRadius: theme.radius.lg,
              padding: "32px 24px",
              textAlign: "center",
              background: alpha(theme.semantic.success, 0.05),
            }}>
              <div style={{ fontSize: theme.fontSize.xl, color: theme.semantic.success, marginBottom: 8 }}>&#10003;</div>
              <div style={{ fontSize: theme.fontSize.base, color: theme.text.primary, fontFamily: theme.font.mono }}>{session.file}</div>
              <div style={{ fontSize: theme.fontSize.sm, color: theme.text.secondary, marginTop: 4 }}>{session.metadata?.totalEvents} events</div>
            </div>
          ) : (
            <FileUploader onLoad={onLoadSessionA} />
          )}
          {session.error && <div style={{ fontSize: theme.fontSize.sm, color: theme.semantic.error }}>{session.error}</div>}
        </div>

        <div style={{ display: "flex", alignItems: "center", paddingTop: 60, flexShrink: 0 }}>
          <span style={{ fontSize: theme.fontSize.xl, color: theme.text.muted, fontFamily: theme.font.ui, fontWeight: 600 }}>vs</span>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: theme.fontSize.sm, color: theme.text.secondary, fontFamily: theme.font.ui, letterSpacing: 1, textTransform: "uppercase" }}>
            Session B
          </div>
          {sessionB.events ? (
            <div style={{
              border: "1px solid " + theme.semantic.success,
              borderRadius: theme.radius.lg,
              padding: "32px 24px",
              textAlign: "center",
              background: alpha(theme.semantic.success, 0.05),
            }}>
              <div style={{ fontSize: theme.fontSize.xl, color: theme.semantic.success, marginBottom: 8 }}>&#10003;</div>
              <div style={{ fontSize: theme.fontSize.base, color: theme.text.primary, fontFamily: theme.font.mono }}>{sessionB.file}</div>
              <div style={{ fontSize: theme.fontSize.sm, color: theme.text.secondary, marginTop: 4 }}>{sessionB.metadata?.totalEvents} events</div>
            </div>
          ) : (
            <FileUploader onLoad={sessionB.handleFile} />
          )}
          {sessionB.error && <div style={{ fontSize: theme.fontSize.sm, color: theme.semantic.error }}>{sessionB.error}</div>}
        </div>
      </div>

      <button
        type="button"
        onClick={onExitCompare}
        className="av-btn"
        style={{
          color: theme.text.link,
          cursor: "pointer",
          fontSize: theme.fontSize.base,
          fontFamily: theme.font.ui,
          background: "none",
          border: "none",
          padding: "4px 8px",
          borderRadius: theme.radius.md,
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        cancel
      </button>
    </ShellFrame>
  );
}
