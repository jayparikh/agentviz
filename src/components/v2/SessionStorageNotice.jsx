import { theme } from "../../lib/theme.js";
import { downloadText } from "../../lib/downloadText";
import useAsyncStatus from "../../hooks/useAsyncStatus.js";
import ExportStatusButton from "../ui/ExportStatusButton.jsx";
import ToolbarButton from "../ui/ToolbarButton.jsx";

function rowStyle() { return {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: theme.space.md,
  padding: "6px 12px",
  borderBottom: "1px solid " + theme.border.default,
  background: theme.bg.surface,
  color: theme.text.secondary,
  fontFamily: theme.font.mono,
  fontSize: theme.fontSize.base,
}; }

function ActiveCopy({ loader, label }) {
  var download = useAsyncStatus();
  var status = loader.storageStatus;
  if (!status) return null;
  return (
    <div style={rowStyle()} data-testid={"storage-" + label.toLowerCase()}>
      <span role="status" style={{ minWidth: 0, overflowWrap: "anywhere", flex: "1 1 280px" }}>
        {label} active: {loader.file}.{" "}
        {status.saved ? "Saved locally."
          : status.pending && !status.error ? "Latest snapshot awaiting local save."
          : "Latest transcript not saved locally. " + (status.error ? status.error.message : "")}
        {!status.saved && (!status.pending || status.error) && " You can keep working. Retry saving or download the active transcript before closing."}
        {status.previousSaved && " An earlier local snapshot is still available."}
        {status.error && (status.error.operation === "write index" || status.error.indexError) && " The session index could not be saved."}
        {status.error && status.error.rollbackError && " The earlier local copy could not be restored."}
      </span>
      {!status.saved && (!status.pending || status.error) && <ToolbarButton onClick={loader.retrySave}>Retry saving</ToolbarButton>}
      {!status.saved && <ExportStatusButton
        state={download.state}
        error={download.error}
        label="Download transcript"
        title="Download the active raw transcript, without relying on browser storage"
        onClick={function () {
          var text = loader.getRawText();
          var name = loader.file || "session.jsonl";
          download.run(function () { downloadText(text, name); });
        }}
      />}
      {download.error && <span role="alert" style={{ color: theme.semantic.errorText }}>{download.error}</span>}
    </div>
  );
}

export default function SessionStorageNotice({ sessionState }) {
  var state = sessionState;
  return (
    <section aria-label="Local session storage" style={{ flexShrink: 0 }}>
      {state.storageError && ![state.session, state.sessionB].some(function (loader) {
        return loader.storageStatus && loader.storageStatus.error === state.storageError;
      }) && (
        <div style={rowStyle()}>
          <span role="status" style={{ flex: "1 1 280px", overflowWrap: "anywhere" }}>
            {state.storageError.message} Saved session availability could not be confirmed.
            {state.storageError.operation === "write index" && " The session index could not be updated."}
          </span>
          <ToolbarButton onClick={state.refreshSessions}>Retry storage</ToolbarButton>
        </div>
      )}
      <ActiveCopy key={"a-" + state.session.sessionKey} loader={state.session} label="A" />
      <ActiveCopy key={"b-" + state.sessionB.sessionKey} loader={state.sessionB} label="B" />
      {state.evictedIds.length > 0 && (
        <div style={rowStyle()}>
          <span role="status" style={{ flex: "1 1 280px" }}>
            Storage was full. Removed {state.evictedIds.length} older cached transcript{state.evictedIds.length === 1 ? "" : "s"}.
            {" "}Active transcripts remain usable. Reimport removed files or reopen their discovered source.
          </span>
          <ToolbarButton onClick={state.dismissEvictions} aria-label="Dismiss storage eviction notice">Dismiss</ToolbarButton>
        </div>
      )}
    </section>
  );
}
