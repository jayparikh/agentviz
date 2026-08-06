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
  .av-search:focus { border-color: var(--av-focus) !important; outline: none !important; }
  .av-search-wrap:focus-within { border-color: var(--av-focus) !important; }
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

function bytesToDataUrl(bytes, mimeType) {
  var binary = "";
  var chunkSize = 0x8000;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return "data:" + mimeType + ";base64," + btoa(binary);
}

function textToDataUrl(text, mimeType) {
  return bytesToDataUrl(new TextEncoder().encode(text), mimeType);
}

function findModuleSpecifiers(source) {
  var specifiers = [];
  var pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])([^"']+)\1/g;
  var match;
  while ((match = pattern.exec(source)) !== null) {
    specifiers.push(match[2]);
  }
  return specifiers;
}

function findAssetSpecifiers(source) {
  var specifiers = [];
  var pattern = /new URL\(\s*(["'])([^"'\\\s+]+)\1\s*,\s*import\.meta\.url\s*\)/g;
  var match;
  while ((match = pattern.exec(source)) !== null) {
    specifiers.push(match[2]);
  }
  return specifiers;
}

function rewriteModuleSpecifiers(source, moduleUrl) {
  return source.replace(
    /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])([^"']+)\2/g,
    function (full, prefix, quote, specifier) {
      if (!specifier.startsWith(".")) return full;
      return prefix + quote + new URL(specifier, moduleUrl).href + quote;
    }
  );
}

function rewriteAssetSpecifiers(source, moduleUrl, assetDataUrls) {
  return source.replace(
    /new URL\(\s*(["'])([^"'\\\s+]+)\1\s*,\s*import\.meta\.url\s*\)/g,
    function (full, quote, specifier) {
      var assetUrl = new URL(specifier, moduleUrl).href;
      var dataUrl = assetDataUrls[assetUrl];
      if (!dataUrl) return full;
      return "new URL(" + quote + dataUrl + quote + ",import.meta.url)";
    }
  );
}

async function fetchBundleGraph() {
  var scriptEl = document.querySelector('script[type="module"][src*="/assets/index-"]');
  if (!scriptEl) {
    throw new Error(
      "Production bundle not found. Export is only available when served via " +
      "`node bin/agentviz.js` or `node server.js` (not the Vite dev server)."
    );
  }

  var entryUrl = scriptEl.src;
  var moduleSources = {};
  var assetDataUrls = {};
  var pendingModules = {};
  var pendingAssets = {};

  async function fetchAsset(assetUrl) {
    if (assetDataUrls[assetUrl]) return;
    if (pendingAssets[assetUrl]) return pendingAssets[assetUrl];

    pendingAssets[assetUrl] = fetch(assetUrl).then(async function (resp) {
      if (!resp.ok) throw new Error("Failed to fetch export asset: HTTP " + resp.status);
      var mimeType = resp.headers.get("Content-Type") || "application/octet-stream";
      var buffer = await resp.arrayBuffer();
      assetDataUrls[assetUrl] = bytesToDataUrl(new Uint8Array(buffer), mimeType);
    });
    return pendingAssets[assetUrl];
  }

  async function fetchModule(moduleUrl) {
    if (moduleSources[moduleUrl]) return;
    if (pendingModules[moduleUrl]) return pendingModules[moduleUrl];

    pendingModules[moduleUrl] = fetch(moduleUrl).then(async function (resp) {
      if (!resp.ok) throw new Error("Failed to fetch export bundle: HTTP " + resp.status);
      var source = await resp.text();
      moduleSources[moduleUrl] = source;

      var moduleUrls = findModuleSpecifiers(source)
        .filter(function (specifier) { return specifier.startsWith("."); })
        .map(function (specifier) { return new URL(specifier, moduleUrl).href; });
      var assetUrls = findAssetSpecifiers(source)
        .map(function (specifier) { return new URL(specifier, moduleUrl).href; });

      await Promise.all(
        moduleUrls.map(fetchModule).concat(assetUrls.map(fetchAsset))
      );
    });
    return pendingModules[moduleUrl];
  }

  await fetchModule(entryUrl);

  var imports = {};
  Object.keys(moduleSources).forEach(function (moduleUrl) {
    var source = rewriteModuleSpecifiers(moduleSources[moduleUrl], moduleUrl);
    source = rewriteAssetSpecifiers(source, moduleUrl, assetDataUrls);
    imports[moduleUrl] = textToDataUrl(source, "text/javascript");
  });

  return { entryUrl: entryUrl, imports: imports };
}

function buildHtml(title, setupScript, bundleGraph) {
  var importMap = jsonSafe({ imports: bundleGraph.imports });
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
    '  <script type="importmap">' + importMap + "</" + "script>\n" +
    '  <script type="module">import(' + jsonSafe(bundleGraph.entryUrl) + ");</" + "script>\n" +
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
  var bundleGraph = await fetchBundleGraph();

  var metaPayload = jsonSafe({ filename: filename, live: false });
  var rawTextPayload = jsonSafe(rawText);

  // Runs synchronously before the module, overriding fetch for the two API
  // endpoints that useSessionLoader calls during its initFromUrl effect.
  var setupScript =
    "<script>\n" +
    "(function() {\n" +
    "  window.__AGENTVIZ_STANDALONE__ = true;\n" +
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
  downloadHtml(buildHtml("AGENTVIZ - " + filename, setupScript, bundleGraph), exportName);
}

// Export a side-by-side comparison as a self-contained HTML file.
export async function exportComparison(rawTextA, filenameA, rawTextB, filenameB) {
  var bundleGraph = await fetchBundleGraph();

  var comparePayload = jsonSafe({ a: { name: filenameA, text: rawTextA }, b: { name: filenameB, text: rawTextB } });

  var setupScript =
    "<script>window.__AGENTVIZ_STANDALONE__ = true; window.__AGENTVIZ_COMPARE__ = " + comparePayload + ";</" + "script>";

  downloadHtml(buildHtml("AGENTVIZ - Comparison", setupScript, bundleGraph), "comparison-agentviz.html");
}
