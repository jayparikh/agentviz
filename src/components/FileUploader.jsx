import { useState, useRef } from "react";
import { FONT } from "../lib/constants.js";

export default function FileUploader({ onLoad }) {
  var ref = useRef(null);
  var [over, setOver] = useState(false);

  function handleFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) { onLoad(e.target.result, file.name); };
    reader.readAsText(file);
  }

  return (
    <div
      onDragOver={function (e) { e.preventDefault(); setOver(true); }}
      onDragLeave={function () { setOver(false); }}
      onDrop={function (e) { e.preventDefault(); setOver(false); handleFile(e.dataTransfer.files[0]); }}
      onClick={function () { ref.current && ref.current.click(); }}
      style={{
        border: "2px dashed " + (over ? "#22d3ee" : "#334155"),
        borderRadius: 12, padding: "48px 32px", textAlign: "center",
        cursor: "pointer", background: over ? "#22d3ee08" : "#0f172a",
        transition: "all 0.2s", maxWidth: 560, margin: "0 auto",
      }}
    >
      <input
        ref={ref} type="file" accept=".jsonl,.json,.txt"
        style={{ display: "none" }}
        onChange={function (e) { handleFile(e.target.files[0]); }}
      />
      <div style={{ fontSize: 32, marginBottom: 12, color: "#22d3ee" }}>{"\u25C8"}</div>
      <div style={{ fontSize: 15, color: "#e2e8f0", marginBottom: 8, fontWeight: 600 }}>
        Drop a Claude Code session file here
      </div>
      <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.8 }}>
        Find sessions at{" "}
        <span style={{ color: "#94a3b8", fontFamily: FONT, fontSize: 11 }}>
          ~/.claude/projects/&lt;project&gt;/*.jsonl
        </span>
        <br />Accepts .jsonl, .json, or .txt
      </div>
    </div>
  );
}
