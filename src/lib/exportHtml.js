// Builds a self-contained single-file HTML export for sharing sessions.
// Single session: overrides window.fetch to serve embedded JSONL via the
//   existing /api/meta + /api/file endpoints that useSessionLoader already
//   calls on startup.
// Comparison: sets window.__AGENTVIZ_COMPARE__ which App.jsx reads on mount.

var INLINE_STYLES = `
  :root {
    --av-bg-hover: #20202e;
    --av-bg-active: #26263a;
    --av-focus: #6475e8;
    --av-border: #2c2c30;
    --av-border-strong: #3a3a3f;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #000000; overflow: hidden; font-family: 'JetBrains Mono', monospace; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #3a3a3f; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #45454b; }
  *:focus-visible { outline: 2px solid var(--av-focus); outline-offset: 2px; }
  *:focus:not(:focus-visible) { outline: none; }
  .av-btn { cursor: pointer; transition: background 80ms ease-out, border-color 80ms ease-out, color 80ms ease-out; }
  .av-btn:hover { background: var(--av-bg-hover); }
  .av-btn:active { background: var(--av-bg-active); }
  .av-interactive { transition: background 80ms ease-out; }
  .av-interactive:hover { background: var(--av-bg-hover); }
  .av-search:focus { border-color: var(--av-focus) !important; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

// JSON-serialize a value so it is safe to embed inside a <script> block.
// Escapes <, >, and & to prevent HTML parser from seeing </script> etc.
function jsonSafe(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function escapeHtmlAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function fetchBundleText() {
  var scriptEl = document.querySelector('script[type="module"][src*="/assets/index-"]');
  if (!scriptEl) {
    throw new Error(
      "Production bundle not found. Export is only available when served via " +
      "`node bin/agentviz.js` or `node server.js` (not the Vite dev server)."
    );
  }
  var resp = await fetch(scriptEl.src);
  if (!resp.ok) throw new Error("Failed to fetch bundle: HTTP " + resp.status);
  return resp.text();
}

function buildHtml(title, setupScript, bundleText) {
  // The <\/script> split trick prevents the HTML parser from ending the
  // outer script block early if bundleText itself contains </script>.
  return "<!DOCTYPE html>\n" +
    '<html lang="en">\n' +
    "<head>\n" +
    '  <meta charset="UTF-8" />\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    "  <title>" + escapeHtmlAttr(title) + "</title>\n" +
    '  <link rel="preconnect" href="https://fonts.googleapis.com" />\n' +
    '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n' +
    '  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />\n' +
    "  <style>" + INLINE_STYLES + "  </style>\n" +
    "</head>\n" +
    "<body>\n" +
    '  <div id="root"></div>\n' +
    (setupScript ? "  " + setupScript + "\n" : "") +
    '  <script type="module">\n' +
    bundleText + "\n" +
    "  </" + "script>\n" +
    "</body>\n" +
    "</html>";
}

function downloadHtml(html, filename) {
  var blob = new Blob([html], { type: "text/html" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}

// Export a single session as a self-contained HTML file.
// rawText: the full JSONL content; filename: original file name.
export async function exportSingleSession(rawText, filename) {
  var bundleText = await fetchBundleText();

  var metaPayload = jsonSafe({ filename: filename, live: false });
  var rawTextPayload = jsonSafe(rawText);

  // Runs synchronously before the module, overriding fetch for the two API
  // endpoints that useSessionLoader calls during its initFromUrl effect.
  var setupScript =
    "<script>\n" +
    "(function() {\n" +
    "  var _orig = window.fetch;\n" +
    "  var _meta = " + metaPayload + ";\n" +
    "  var _text = " + rawTextPayload + ";\n" +
    "  window.fetch = function(url, opts) {\n" +
    "    var s = String(url);\n" +
    '    if (s.indexOf("/api/meta") !== -1) {\n' +
    '      return Promise.resolve(new Response(JSON.stringify(_meta), { status: 200, headers: { "Content-Type": "application/json" } }));\n' +
    "    }\n" +
    '    if (s.indexOf("/api/file") !== -1) {\n' +
    '      return Promise.resolve(new Response(_text, { status: 200, headers: { "Content-Type": "text/plain" } }));\n' +
    "    }\n" +
    "    return _orig.apply(window, arguments);\n" +
    "  };\n" +
    "})();\n" +
    "</" + "script>";

  var exportName = filename.replace(/\.jsonl$/, "") + "-agentviz.html";
  downloadHtml(buildHtml("AGENTVIZ - " + filename, setupScript, bundleText), exportName);
}

// Export a side-by-side comparison as a self-contained HTML file.
export async function exportComparison(rawTextA, filenameA, rawTextB, filenameB) {
  var bundleText = await fetchBundleText();

  var comparePayload = jsonSafe({ a: { name: filenameA, text: rawTextA }, b: { name: filenameB, text: rawTextB } });

  var setupScript =
    "<script>window.__AGENTVIZ_COMPARE__ = " + comparePayload + ";</" + "script>";

  downloadHtml(buildHtml("AGENTVIZ - Comparison", setupScript, bundleText), "comparison-agentviz.html");
}
