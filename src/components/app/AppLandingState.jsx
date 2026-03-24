import { theme } from "../../lib/theme.js";
import FileUploader from "../FileUploader.jsx";
import Icon from "../Icon.jsx";
import InboxView from "../InboxView.jsx";
import BrandWordmark from "../ui/BrandWordmark.jsx";
import ShellFrame from "../ui/ShellFrame.jsx";

export default function AppLandingState({ error, onLoad, onLoadSample, onStartCompare, inboxEntries, onOpenInboxSession }) {
  var hasSessions = (inboxEntries || []).length > 0;
  return (
    <ShellFrame
      style={{
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        position: "relative",
        padding: "32px 24px",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <BrandWordmark style={{ fontSize: theme.fontSize.hero }} />
        <div style={{ fontSize: theme.fontSize.md, color: theme.text.dim, marginTop: 6, lineHeight: 1.6 }}>
          Visualize and improve your AI coding sessions.
        </div>
      </div>

      {hasSessions ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 340px) 1fr", gap: 20, width: "100%", maxWidth: 1200, alignItems: "stretch", flex: 1, minHeight: 0, overflow: "hidden" }}>
          <div style={{
            background: theme.bg.surface,
            border: "1px solid " + theme.border.default,
            borderRadius: theme.radius.xxl,
            padding: "18px 18px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            alignSelf: "start",
          }}>
            <div>
              <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2 }}>
                Import
              </div>
              <div style={{ fontSize: theme.fontSize.md, color: theme.text.secondary, marginTop: 6, lineHeight: 1.6 }}>
                Drop a session file to add it.
              </div>
            </div>
            <FileUploader onLoad={onLoad} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            <InboxView entries={inboxEntries} onOpenSession={onOpenInboxSession} />
          </div>
        </div>
      ) : (
        <div style={{ width: "100%", maxWidth: 600 }}>
          <div style={{
            background: theme.bg.surface,
            border: "1px solid " + theme.border.default,
            borderRadius: theme.radius.xxl,
            padding: "24px 24px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}>
            <div>
              <div style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, textTransform: "uppercase", letterSpacing: 2 }}>
                Import
              </div>
              <div style={{ fontSize: theme.fontSize.md, color: theme.text.secondary, marginTop: 6, lineHeight: 1.6 }}>
                Drop a Claude Code or Copilot CLI session to build local metadata, autonomy metrics, and Coach drafts.
              </div>
            </div>
            <FileUploader onLoad={onLoad} />
          </div>
        </div>
      )}

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
    </ShellFrame>
  );
}
