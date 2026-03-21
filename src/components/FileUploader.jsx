import { useState, useRef } from "react";
import { theme, alpha } from "../lib/theme.js";
import Icon from "./Icon.jsx";

export default function FileUploader({ onLoad }) {
  var ref = useRef(null);
  var [over, setOver] = useState(false);

  var [readError, setReadError] = useState(null);

  function handleFile(file) {
    if (!file) return;
    setReadError(null);
    var reader = new FileReader();
    reader.onload = function (e) { onLoad(e.target.result, file.name); };
    reader.onerror = function () { setReadError("Could not read file: " + file.name); };
    reader.readAsText(file);
  }

  return (
    <div
      onDragOver={function (e) { e.preventDefault(); setOver(true); }}
      onDragLeave={function () { setOver(false); }}
      onDrop={function (e) { e.preventDefault(); setOver(false); handleFile(e.dataTransfer.files[0]); }}
      onClick={function () { ref.current && ref.current.click(); }}
      style={{
        border: "2px dashed " + (over ? theme.accent.primary : theme.border.strong),
        borderRadius: theme.radius.xxl, padding: "48px 32px", textAlign: "center",
        cursor: "pointer", background: over ? alpha(theme.accent.primary, 0.03) : theme.bg.surface,
        transition: "all " + theme.transition.smooth, maxWidth: 560, margin: "0 auto",
      }}
    >
      <input
        ref={ref} type="file" accept=".jsonl,.json,.txt"
        style={{ display: "none" }}
        onChange={function (e) { handleFile(e.target.files[0]); }}
      />
      <div style={{
        fontSize: 32, marginBottom: 12, color: theme.accent.primary,
        transition: "transform " + theme.transition.smooth,
        transform: over ? "scale(1.1)" : "scale(1)",
      }}><Icon name="upload" size={32} /></div>
      <div style={{ fontSize: theme.fontSize.xl, color: theme.text.primary, marginBottom: 8, fontWeight: 600 }}>
        Drop a session file here
      </div>
      <div style={{ fontSize: theme.fontSize.md, color: theme.text.muted, lineHeight: 1.8 }}>
        Claude Code .jsonl sessions
        <br />
        <span style={{ color: theme.text.dim, fontSize: theme.fontSize.base }}>
          Also accepts .json and .txt
        </span>
      </div>
      {readError && (
        <div style={{ marginTop: 12, fontSize: theme.fontSize.base, color: theme.semantic.error }}>
          {readError}
        </div>
      )}
    </div>
  );
}
