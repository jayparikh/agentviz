import { alpha, theme } from "../../lib/theme.js";
import FileUploader from "../FileUploader.jsx";

export default function CompareLandingState({ session, sessionB, onLoadSessionA, onExitCompare }) {
  return (
    <div style={{
      width: "100%", height: "100vh", background: theme.bg.base,
      color: theme.text.primary, fontFamily: theme.font.mono,
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: 32, overflow: "hidden",
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: theme.fontSize.hero, fontWeight: 600, fontFamily: theme.font.ui, letterSpacing: "-0.5px", color: theme.text.primary }}>
          AGENTVIZ<span style={{ color: theme.accent.primary }}>.</span>
        </div>
        <div style={{ fontSize: theme.fontSize.md, color: theme.text.dim, marginTop: 6 }}>
          Compare two agent sessions head to head.
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", width: "100%", maxWidth: 900, padding: "0 24px" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: theme.fontSize.sm, color: theme.accent.primary, fontFamily: theme.font.ui, letterSpacing: 1, textTransform: "uppercase" }}>
            Session A
          </div>
          {session.events ? (
            <div style={{
              border: "2px solid " + theme.semantic.success, borderRadius: theme.radius.xxl,
              padding: "32px 24px", textAlign: "center", background: alpha(theme.semantic.success, 0.05),
            }}>
              <div style={{ fontSize: theme.fontSize.xl, color: theme.semantic.success, marginBottom: 8 }}>&#10003;</div>
              <div style={{ fontSize: theme.fontSize.base, color: theme.text.primary, fontFamily: theme.font.mono }}>{session.file}</div>
              <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, marginTop: 4 }}>{session.metadata?.totalEvents} events</div>
            </div>
          ) : (
            <FileUploader onLoad={onLoadSessionA} />
          )}
          {session.error && <div style={{ fontSize: theme.fontSize.sm, color: theme.semantic.error }}>{session.error}</div>}
        </div>

        <div style={{ display: "flex", alignItems: "center", paddingTop: 60, flexShrink: 0 }}>
          <span style={{ fontSize: theme.fontSize.xl, color: theme.text.ghost, fontFamily: theme.font.ui, fontWeight: 600 }}>vs</span>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: theme.fontSize.sm, color: "#a78bfa", fontFamily: theme.font.ui, letterSpacing: 1, textTransform: "uppercase" }}>
            Session B
          </div>
          {sessionB.events ? (
            <div style={{
              border: "2px solid " + theme.semantic.success, borderRadius: theme.radius.xxl,
              padding: "32px 24px", textAlign: "center", background: alpha(theme.semantic.success, 0.05),
            }}>
              <div style={{ fontSize: theme.fontSize.xl, color: theme.semantic.success, marginBottom: 8 }}>&#10003;</div>
              <div style={{ fontSize: theme.fontSize.base, color: theme.text.primary, fontFamily: theme.font.mono }}>{sessionB.file}</div>
              <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, marginTop: 4 }}>{sessionB.metadata?.totalEvents} events</div>
            </div>
          ) : (
            <FileUploader onLoad={sessionB.handleFile} />
          )}
          {sessionB.error && <div style={{ fontSize: theme.fontSize.sm, color: theme.semantic.error }}>{sessionB.error}</div>}
        </div>
      </div>

      <span onClick={onExitCompare} style={{ color: theme.text.dim, cursor: "pointer", fontSize: theme.fontSize.sm }}>
        cancel
      </span>
    </div>
  );
}
