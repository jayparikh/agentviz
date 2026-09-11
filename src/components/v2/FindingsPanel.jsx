import { useMemo, useRef, useState } from "react";
import { theme } from "../../lib/theme.js";
import { MAX_NOTE_LENGTH, validateFindingsPayload } from "../../lib/findings";
import { downloadText } from "../../lib/downloadText";
import useAsyncStatus from "../../hooks/useAsyncStatus.js";
import ToolbarButton from "../ui/ToolbarButton.jsx";
import ExportStatusButton from "../ui/ExportStatusButton.jsx";

function controlsStyle() {
  return { display: "flex", flexWrap: "wrap", alignItems: "center", gap: theme.space.md };
}

export function FindingsRecovery({ session }) {
  var download = useAsyncStatus();
  var findings = session.findings;
  var [confirmReload, setConfirmReload] = useState(false);
  return (
    <div style={controlsStyle()}>
      {findings.error && <span role="status" style={{ color: theme.semantic.errorText, overflowWrap: "anywhere", flex: "1 1 240px" }}>
        Findings not saved locally. {findings.error.message} Download findings before closing.
      </span>}
      {(findings.error || findings.dirty) && <ToolbarButton onClick={findings.retry}>Retry findings save</ToolbarButton>}
      {findings.error && <ToolbarButton onClick={function () { setConfirmReload(true); }}>Reload saved findings</ToolbarButton>}
      <ExportStatusButton state={download.state} error={download.error} label="Download findings"
        title="Download bookmarks and note drafts as JSON, including unsaved and unavailable findings"
        onClick={function () { download.run(function () {
          downloadText(JSON.stringify(findings.payload(session.getRawText()), null, 2), "agentviz-findings.json", "application/json");
        }); }} />
      {download.error && <span role="alert" style={{ color: theme.semantic.errorText }}>{download.error}</span>}
      {confirmReload && <div style={controlsStyle()}>
        <span>Discard in-memory findings and drafts and reload the saved copy?</span>
        <ToolbarButton onClick={function () { findings.reload(); setConfirmReload(false); }}>Discard edits and reload</ToolbarButton>
        <ToolbarButton onClick={function () { setConfirmReload(false); }}>Cancel reload</ToolbarButton>
      </div>}
    </div>
  );
}

export function FindingActions({ entry, findings }) {
  var selected = findings.forEntry(entry);
  var item = selected.item;
  var draft = selected.draft;
  return (
    <div style={{ width: "100%", minWidth: 0, color: theme.text.secondary, fontSize: theme.reading.fontSize, lineHeight: 1.6 }}>
      <div style={controlsStyle()}>
        {!item && !draft && <ToolbarButton icon="bookmark" onClick={function () { findings.save(entry, ""); }}>Bookmark event</ToolbarButton>}
        {item && <span role="status">{findings.dirty || findings.error ? "Bookmark not saved locally" : findings.embedded ? "Bookmark included in export" : "Bookmark saved locally"}</span>}
        {!draft && <ToolbarButton icon="pencil" onClick={function () { findings.setDraft(entry, item ? item.note : ""); }}>
          {item && item.note ? "Edit note" : "Add note"}
        </ToolbarButton>}
        {item && <ToolbarButton onClick={function () { findings.remove(item.id); }}>
          {item.note || draft ? "Remove bookmark and note" : "Remove bookmark"}
        </ToolbarButton>}
      </div>
      {item && item.note && !draft && <p style={{ margin: theme.space.md + "px 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.note}</p>}
      {draft && <div style={{ marginTop: theme.space.md }}>
        <label htmlFor={"finding-note-" + entry.index}>Event note</label>
        <textarea id={"finding-note-" + entry.index} value={draft.note} maxLength={MAX_NOTE_LENGTH}
          onChange={function (event) { findings.setDraft(entry, event.target.value); }}
          rows={4} autoFocus
          style={{ display: "block", boxSizing: "border-box", width: "100%", minWidth: 0, resize: "vertical",
            margin: theme.space.sm + "px 0", padding: theme.space.md, border: "1px solid " + theme.border.default,
            borderRadius: theme.radius.md, background: theme.bg.base, color: theme.text.primary,
            fontFamily: theme.font.mono, fontSize: theme.reading.fontSize, lineHeight: 1.6 }} />
        <div style={controlsStyle()}>
          <ToolbarButton onClick={function () { findings.save(entry, draft.note); }}>Save note</ToolbarButton>
          <ToolbarButton onClick={function () { findings.cancelDraft(selected.id); }}>Cancel note</ToolbarButton>
          <span style={{ color: theme.text.muted }}>Unsaved draft · {draft.note.length}/{MAX_NOTE_LENGTH}</span>
        </div>
      </div>}
    </div>
  );
}

export default function FindingsPanel({ session, onJump }) {
  var findings = session.findings;
  var inputRef = useRef(null);
  var [backup, setBackup] = useState(null);
  var [importError, setImportError] = useState(null);
  var [limit, setLimit] = useState(50);
  var items = findings.entries;
  var itemIds = useMemo(function () { return new Set(items.map(function (item) { return item.id; })); }, [items]);
  var drafts = findings.draftEntries.filter(function (draft) { return !itemIds.has(draft.id); });
  var rows = items.concat(drafts);
  return (
    <section id="investigate-bookmarks" aria-label="Bookmarks" style={{
      flexShrink: 0, maxHeight: 240, overflow: "auto", padding: theme.space.lg + "px " + theme.space.xl + "px",
      borderBottom: "1px solid " + theme.border.default, background: theme.bg.surface,
      fontFamily: theme.font.mono, color: theme.text.secondary, fontSize: theme.reading.fontSize, lineHeight: 1.6,
    }}>
      <div style={controlsStyle()}>
        <strong style={{ color: theme.text.primary }}>Bookmarks ({items.length})</strong>
        <span role="status">{findings.dirty ? "Changes not saved locally" : findings.embedded ? "Included in export" : items.length && !findings.error ? "Saved locally" : ""}</span>
        <ToolbarButton onClick={function () { inputRef.current.click(); }}>Restore findings</ToolbarButton>
        <input ref={inputRef} type="file" accept=".json" aria-label="Restore findings backup" style={{ display: "none" }}
          onChange={async function (event) {
            var file = event.target.files[0];
            event.target.value = "";
            if (!file) return;
            try {
              var value = JSON.parse(await file.text());
              setBackup(validateFindingsPayload(value, findings.sessionId, session.getRawText()));
              setImportError(null);
            } catch (error) { setImportError("This backup is invalid or belongs to a different transcript snapshot. Nothing was changed."); }
          }} />
      </div>
      {!findings.error && !findings.dirty && !findings.draftEntries.length && <FindingsRecovery session={session} />}
      {backup && <div style={controlsStyle()}>
        <span>Replace this session's findings and drafts with this backup?</span>
        <ToolbarButton onClick={function () {
          try { findings.restore(backup, session.getRawText()); setBackup(null); }
          catch (error) { setImportError("The transcript changed. Select a backup for the current snapshot."); }
        }}>Replace with backup</ToolbarButton>
        <ToolbarButton onClick={function () { setBackup(null); }}>Cancel restore</ToolbarButton>
      </div>}
      {importError && <p role="alert" style={{ color: theme.semantic.errorText }}>{importError}</p>}
      {rows.length === 0 && <p style={{ margin: theme.space.md + "px 0 0" }}>No bookmarks yet. Select an event, then bookmark it or add a note.</p>}
      <ul style={{ margin: theme.space.md + "px 0 0", padding: 0, listStyle: "none" }}>
        {rows.slice(0, limit).map(function (item) {
          var draft = findings.drafts[item.id];
          return (
            <li key={item.id} style={{ borderTop: "1px solid " + theme.border.default, padding: theme.space.md + "px 0" }}>
              <div style={controlsStyle()}>
                <ToolbarButton disabled={!item.available} onClick={function () { onJump(item.anchor.index); }}
                  aria-label={"Jump to bookmarked event " + (item.anchor.index + 1)}
                  style={{ minHeight: theme.reading.controlMin, maxWidth: "100%", color: theme.text.primary }}>
                  Event {item.anchor.index + 1}
                </ToolbarButton>
                <span style={{ flex: "1 1 200px", minWidth: 0, overflowWrap: "anywhere" }}>{item.label}</span>
                {draft && <span>Unsaved note draft</span>}
                {!item.available && <span>Unavailable in this snapshot</span>}
                <ToolbarButton onClick={function () { findings.remove(item.id); }}>
                  {item.note || draft ? "Remove bookmark and note" : "Remove bookmark"}
                </ToolbarButton>
              </div>
              {(draft ? draft.note : item.note) && <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: theme.space.sm + "px 0 0" }}>
                {draft ? draft.note : item.note}
              </p>}
            </li>
          );
        })}
      </ul>
      {rows.length > limit && <ToolbarButton onClick={function () { setLimit(function (value) { return value + 50; }); }}>Show next 50 findings</ToolbarButton>}
    </section>
  );
}
