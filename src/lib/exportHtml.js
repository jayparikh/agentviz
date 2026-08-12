// Builds a self-contained single-file HTML export for sharing sessions.
//
// Portability rules this file must keep:
//   1. The exported HTML never references the exporting machine's origin.
//      Module sources are embedded as strings and turned into blob: URLs at
//      boot, so nothing is fetched from http://127.0.0.1:<port> on the
//      recipient's machine.
//   2. Modules are loaded from blob: URLs rather than data: URLs, because
//      WebKit refuses to evaluate module scripts served from data: URLs.
//   3. Every network dependency is either embedded or stubbed. Fonts fall back
//      to the local monospace stack and all /api/* calls are answered locally.
//
// Single session: the embedded fetch shim serves the session through the
//   existing /api/meta + /api/file endpoints that useSessionLoader calls on
//   startup.
// Comparison: sets window.__AGENTVIZ_COMPARE__ which App.jsx reads on mount.

var THEME_BOOTSTRAP = `
  (function () {
    var storageKey = "agentviz:theme-mode";
    var preference = "dark";
    try {
      var raw = localStorage.getItem(storageKey);
      if (raw) {
        try { raw = JSON.parse(raw); } catch (e) { /* use as-is */ }
        if (raw === "light" || raw === "dark" || raw === "system") preference = raw;
      }
    } catch (error) {
      preference = "dark";
    }
    var isLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    var resolved = preference === "light" || preference === "dark" ? preference : (isLight ? "light" : "dark");
    var tokens = resolved === "light" ? {
      bgBase: "#f6f7fb",
      bgSurface: "#ffffff",
      bgHover: "#e5e9f2",
      bgActive: "#d8deea",
      focus: "#6475e8",
      border: "#d8deea",
      borderStrong: "#c2cad8",
      textPrimary: "#141824",
      textSecondary: "#4f5669"
    } : {
      bgBase: "#000000",
      bgSurface: "#0f0f16",
      bgHover: "#20202e",
      bgActive: "#26263a",
      focus: "#6475e8",
      border: "#232333",
      borderStrong: "#2e2e42",
      textPrimary: "#f0f0f2",
      textSecondary: "#a1a1a8"
    };
    var root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
    root.style.colorScheme = resolved;
    root.style.setProperty("--av-bg-base", tokens.bgBase);
    root.style.setProperty("--av-bg-surface", tokens.bgSurface);
    root.style.setProperty("--av-bg-hover", tokens.bgHover);
    root.style.setProperty("--av-bg-active", tokens.bgActive);
    root.style.setProperty("--av-focus", tokens.focus);
    root.style.setProperty("--av-border", tokens.border);
    root.style.setProperty("--av-border-strong", tokens.borderStrong);
    root.style.setProperty("--av-text-primary", tokens.textPrimary);
    root.style.setProperty("--av-text-secondary", tokens.textSecondary);
  }());
`;

// The font stack intentionally has no webfont link: an exported file is often
// opened offline, so it falls back to whatever monospace the reader has.
var INLINE_STYLES = `
  :root {
    --av-bg-base: #000000;
    --av-bg-surface: #0f0f16;
    --av-bg-hover: #20202e;
    --av-bg-active: #26263a;
    --av-focus: #6475e8;
    --av-border: #232333;
    --av-border-strong: #2e2e42;
    --av-text-primary: #f0f0f2;
    --av-text-secondary: #a1a1a8;
  }
  :root[data-theme="light"] {
    --av-bg-base: #f6f7fb;
    --av-bg-surface: #ffffff;
    --av-bg-hover: #e5e9f2;
    --av-bg-active: #d8deea;
    --av-focus: #6475e8;
    --av-border: #d8deea;
    --av-border-strong: #c2cad8;
    --av-text-primary: #141824;
    --av-text-secondary: #4f5669;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { background: var(--av-bg-base); }
  body {
    background: var(--av-bg-base);
    color: var(--av-text-primary);
    overflow: hidden;
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--av-border-strong); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--av-text-secondary); }
  *:focus-visible { outline: 2px solid var(--av-focus); outline-offset: 2px; }
  *:focus:not(:focus-visible) { outline: none; }
  .av-btn { cursor: pointer; transition: background 80ms ease-out, border-color 80ms ease-out, color 80ms ease-out; }
  .av-btn:hover { background: var(--av-bg-hover); }
  .av-btn:active { background: var(--av-bg-active); }
  .av-interactive { transition: background 80ms ease-out; }
  .av-interactive:hover { background: var(--av-bg-hover); }
  .av-search:focus { border-color: var(--av-focus) !important; outline: none !important; }
  .av-search-wrap:focus-within { border-color: var(--av-focus) !important; }
  .av-export-status {
    display: flex; flex-direction: column; gap: 12px; align-items: flex-start;
    padding: 32px; max-width: 720px; overflow: auto; height: 100vh;
  }
  .av-export-status h1 { font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; }
  .av-export-status p { font-size: 12px; line-height: 1.7; color: var(--av-text-secondary); }
  .av-export-status pre {
    font-size: 11px; line-height: 1.6; color: var(--av-text-secondary);
    background: var(--av-bg-surface); border: 1px solid var(--av-border);
    border-radius: 4px; padding: 12px; white-space: pre-wrap; word-break: break-word;
    max-width: 100%;
  }
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

// Runs before any module code: decodes the embedded payload, installs the
// offline /api shim, materializes every chunk as a blob: URL, and imports the
// entry module. Any failure before the app mounts renders a readable message
// instead of leaving a blank page behind.
var BOOT_SCRIPT = `
(function () {
  window.__AGENTVIZ_STANDALONE__ = true;

  var PAYLOAD = "__AGENTVIZ_PAYLOAD__";
  var COMPRESSED = __AGENTVIZ_COMPRESSED__;
  var booted = false;

  function showFailure(detail) {
    if (booted) return;
    var root = document.getElementById("root");
    if (!root) return;
    while (root.firstChild) root.removeChild(root.firstChild);
    var box = document.createElement("div");
    box.className = "av-export-status";
    var heading = document.createElement("h1");
    heading.textContent = "This AGENTVIZ export failed to load";
    var intro = document.createElement("p");
    intro.textContent = "The session data is embedded in this file, but your browser could not start the viewer.";
    var hint = document.createElement("p");
    hint.textContent = "Exports need a browser with blob URL modules, dynamic import, and DecompressionStream: Chrome 80+, Edge 80+, Firefox 113+, or Safari 16.4+. Try opening this file in an up-to-date Chrome or Firefox, and make sure it is opened as a local file rather than previewed inside a mail or chat client.";
    box.appendChild(heading);
    box.appendChild(intro);
    box.appendChild(hint);
    if (detail) {
      var pre = document.createElement("pre");
      pre.textContent = String(detail);
      box.appendChild(pre);
    }
    root.appendChild(box);
  }

  window.addEventListener("error", function (event) {
    showFailure(event && event.message ? event.message : "Script error");
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    showFailure(reason && reason.message ? reason.message : String(reason));
  });

  function decodeBase64(value) {
    var binary = atob(value);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function readPayload() {
    if (!COMPRESSED) return Promise.resolve(JSON.parse(PAYLOAD));
    if (typeof DecompressionStream === "undefined") {
      return Promise.reject(new Error("DecompressionStream is not supported by this browser."));
    }
    var stream = new Blob([decodeBase64(PAYLOAD)]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text().then(function (text) { return JSON.parse(text); });
  }

  function jsonResponse(body, status) {
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { "Content-Type": "application/json" }
    }));
  }

  // Everything under /api/* is answered locally. Unhandled routes get an
  // explicit 501 so features that need the CLI backend fail with a message
  // instead of throwing "URL scheme file: is not supported".
  function installFetchShim(payload) {
    var session = payload.session || null;
    var originalFetch = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = function (input, init) {
      var target = String(input && input.url ? input.url : input);
      var apiIndex = target.indexOf("/api/");
      if (apiIndex === -1) {
        if (originalFetch) return originalFetch(input, init);
        return Promise.reject(new Error("Network requests are unavailable in this exported view."));
      }
      var route = target.slice(apiIndex);
      if (session && route.indexOf("/api/meta") === 0) {
        return jsonResponse({ filename: session.filename, live: false });
      }
      if (session && route.indexOf("/api/file") === 0) {
        return Promise.resolve(new Response(session.text, {
          status: 200,
          headers: { "Content-Type": "text/plain" }
        }));
      }
      if (route.indexOf("/api/sessions") === 0) return jsonResponse([]);
      if (route.indexOf("/api/config") === 0) return jsonResponse([]);
      return jsonResponse({
        error: "Not available in exported view",
        exported: true,
        route: route
      }, 501);
    };
  }

  function materialize(payload) {
    var assetUrls = {};
    Object.keys(payload.assets).forEach(function (id) {
      var asset = payload.assets[id];
      var parts = asset.text != null ? [asset.text] : [decodeBase64(asset.base64)];
      assetUrls[id] = URL.createObjectURL(new Blob(parts, { type: asset.mime }));
    });

    var moduleUrls = {};
    window.__AGENTVIZ_MODULE_URLS__ = moduleUrls;
    payload.order.forEach(function (id) {
      var source = payload.modules[id].replace(
        /__AGENTVIZ_(MODULE|ASSET)_([A-Za-z0-9]+)__/g,
        function (full, kind, key) {
          var url = kind === "MODULE" ? moduleUrls[key] : assetUrls[key];
          return url || full;
        }
      );
      moduleUrls[id] = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    });
    return moduleUrls[payload.entry];
  }

  readPayload().then(function (payload) {
    if (payload.compare) window.__AGENTVIZ_COMPARE__ = payload.compare;
    installFetchShim(payload);
    return import(materialize(payload));
  }).then(function () {
    booted = true;
  }).catch(function (error) {
    showFailure(error && error.message ? error.message : String(error));
  });
}());
`;

// JSON-serialize a value so it is safe to embed inside a <script> block.
// Escapes <, >, and & to prevent HTML parser from seeing </script> etc.
function jsonSafe(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtmlAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bytesToBase64(bytes) {
  var binary = "";
  var chunkSize = 0x8000;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function isTextAsset(mimeType) {
  return /^text\//.test(mimeType) || /(javascript|json|xml|\+xml)/.test(mimeType);
}

var DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g;
var STATIC_IMPORT_PATTERN = /(\bfrom\s*|\bimport\s*)(["'])([^"']+)\2/g;
var ASSET_URL_PATTERN = /new URL\(\s*(["'])([^"'\\\s+]+)\1\s*,\s*import\.meta\.url\s*\)/g;

function collectMatches(source, pattern, groupIndex) {
  var found = [];
  var scoped = new RegExp(pattern.source, pattern.flags);
  var match;
  while ((match = scoped.exec(source)) !== null) {
    found.push(match[groupIndex]);
  }
  return found;
}

function isRelative(specifier) {
  return specifier.startsWith(".");
}

function findStaticSpecifiers(source) {
  return collectMatches(source, STATIC_IMPORT_PATTERN, 3).filter(isRelative);
}

function findDynamicSpecifiers(source) {
  return collectMatches(source, DYNAMIC_IMPORT_PATTERN, 2).filter(isRelative);
}

function findAssetSpecifiers(source) {
  return collectMatches(source, ASSET_URL_PATTERN, 2);
}

function moduleToken(id) {
  return "__AGENTVIZ_MODULE_" + id + "__";
}

function assetToken(id) {
  return "__AGENTVIZ_ASSET_" + id + "__";
}

// Rewrites a chunk so it no longer refers to any URL on the exporting server.
// Static imports and asset URLs become placeholder tokens that the boot script
// swaps for blob: URLs; dynamic imports resolve through a runtime lookup so a
// chunk can reference modules that are created after it.
function rewriteSource(source, moduleUrl, moduleIds, assetIds) {
  var rewritten = source.replace(
    DYNAMIC_IMPORT_PATTERN,
    function (full, quote, specifier) {
      if (!isRelative(specifier)) return full;
      var id = moduleIds[new URL(specifier, moduleUrl).href];
      if (!id) return full;
      return "import(window.__AGENTVIZ_MODULE_URLS__[" + quote + id + quote + "])";
    }
  );

  rewritten = rewritten.replace(
    STATIC_IMPORT_PATTERN,
    function (full, prefix, quote, specifier) {
      if (!isRelative(specifier)) return full;
      var id = moduleIds[new URL(specifier, moduleUrl).href];
      if (!id) return full;
      return prefix + quote + moduleToken(id) + quote;
    }
  );

  return rewritten.replace(
    ASSET_URL_PATTERN,
    function (full, quote, specifier) {
      var id = assetIds[new URL(specifier, moduleUrl).href];
      if (!id) return full;
      return "new URL(" + quote + assetToken(id) + quote + ",import.meta.url)";
    }
  );
}

// Dependencies first, so each blob: URL exists before the modules that
// statically import it are created.
function topologicalOrder(moduleIds, staticDeps) {
  var order = [];
  var state = {};

  function visit(moduleUrl) {
    if (state[moduleUrl] === "done") return;
    if (state[moduleUrl] === "visiting") {
      throw new Error(
        "Export failed: the production bundle contains a static import cycle involving " + moduleUrl + "."
      );
    }
    state[moduleUrl] = "visiting";
    (staticDeps[moduleUrl] || []).forEach(visit);
    state[moduleUrl] = "done";
    order.push(moduleIds[moduleUrl]);
  }

  Object.keys(moduleIds).forEach(visit);
  return order;
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
  var assetPayloads = {};
  var pendingModules = {};
  var pendingAssets = {};

  async function fetchAsset(assetUrl) {
    if (assetPayloads[assetUrl]) return;
    if (pendingAssets[assetUrl]) return pendingAssets[assetUrl];

    pendingAssets[assetUrl] = fetch(assetUrl).then(async function (resp) {
      if (!resp.ok) throw new Error("Failed to fetch export asset: HTTP " + resp.status);
      var mimeType = resp.headers.get("Content-Type") || "application/octet-stream";
      if (isTextAsset(mimeType)) {
        assetPayloads[assetUrl] = { mime: mimeType, text: await resp.text() };
        return;
      }
      var buffer = await resp.arrayBuffer();
      assetPayloads[assetUrl] = { mime: mimeType, base64: bytesToBase64(new Uint8Array(buffer)) };
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

      var moduleUrls = findStaticSpecifiers(source)
        .concat(findDynamicSpecifiers(source))
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

  var moduleIds = {};
  Object.keys(moduleSources).forEach(function (moduleUrl, index) {
    moduleIds[moduleUrl] = "m" + index;
  });
  var assetIds = {};
  Object.keys(assetPayloads).forEach(function (assetUrl, index) {
    assetIds[assetUrl] = "a" + index;
  });

  var modules = {};
  var assets = {};
  var staticDeps = {};

  Object.keys(moduleSources).forEach(function (moduleUrl) {
    staticDeps[moduleUrl] = findStaticSpecifiers(moduleSources[moduleUrl])
      .map(function (specifier) { return new URL(specifier, moduleUrl).href; })
      .filter(function (depUrl) { return Boolean(moduleIds[depUrl]); });
    modules[moduleIds[moduleUrl]] = rewriteSource(moduleSources[moduleUrl], moduleUrl, moduleIds, assetIds);
  });
  Object.keys(assetPayloads).forEach(function (assetUrl) {
    assets[assetIds[assetUrl]] = assetPayloads[assetUrl];
  });

  return {
    entry: moduleIds[entryUrl],
    order: topologicalOrder(moduleIds, staticDeps),
    modules: modules,
    assets: assets,
  };
}

// A single origin reference would make the export work only on the machine
// that produced it, so this fails the export instead of shipping the file.
function assertNoOriginReferences(bundleGraph) {
  var origin = typeof window !== "undefined" && window.location ? window.location.origin : null;
  var host = typeof window !== "undefined" && window.location ? window.location.host : null;
  var candidates = [origin, host].filter(function (value) {
    return Boolean(value) && value !== "null";
  });
  if (candidates.length === 0) return;

  var serialized = JSON.stringify({ modules: bundleGraph.modules, assets: bundleGraph.assets });
  candidates.forEach(function (needle) {
    if (serialized.indexOf(needle) !== -1) {
      throw new Error(
        "Export aborted: the generated bundle still references " + needle + ", " +
        "so the file would only work on this machine. Please report this as an AGENTVIZ bug."
      );
    }
  });
}

async function encodePayload(payload) {
  var json = JSON.stringify(payload);
  if (typeof CompressionStream === "undefined") {
    return { compressed: false, data: json };
  }
  var stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
  var buffer = await new Response(stream).arrayBuffer();
  return { compressed: true, data: bytesToBase64(new Uint8Array(buffer)) };
}

function buildBootScript(encoded) {
  // Function replacements keep `$` sequences inside minified sources literal.
  var body = BOOT_SCRIPT
    .replace('"__AGENTVIZ_PAYLOAD__"', function () { return jsonSafe(encoded.data); })
    .replace("__AGENTVIZ_COMPRESSED__", function () { return encoded.compressed ? "true" : "false"; });
  return "<script>" + body + "</" + "script>";
}

function buildHtml(title, bootScript) {
  return "<!DOCTYPE html>\n" +
    '<html lang="en">\n' +
    "<head>\n" +
    '  <meta charset="UTF-8" />\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    "  <title>" + escapeHtmlAttr(title) + "</title>\n" +
    "  <script>" + THEME_BOOTSTRAP + "  </" + "script>\n" +
    "  <style>" + INLINE_STYLES + "  </style>\n" +
    "</head>\n" +
    "<body>\n" +
    '  <div id="root">\n' +
    '    <div class="av-export-status">\n' +
    "      <h1>AGENTVIZ</h1>\n" +
    "      <p>Loading the embedded session...</p>\n" +
    "    </div>\n" +
    "  </div>\n" +
    "  <noscript>\n" +
    "    <div class=\"av-export-status\">\n" +
    "      <h1>JavaScript required</h1>\n" +
    "      <p>This AGENTVIZ export renders its session with JavaScript. Enable JavaScript and reload this file.</p>\n" +
    "    </div>\n" +
    "  </noscript>\n" +
    "  " + bootScript + "\n" +
    "</body>\n" +
    "</html>";
}

async function buildExportHtml(title, extraPayload) {
  var bundleGraph = await fetchBundleGraph();
  assertNoOriginReferences(bundleGraph);

  var payload = {
    entry: bundleGraph.entry,
    order: bundleGraph.order,
    modules: bundleGraph.modules,
    assets: bundleGraph.assets,
  };
  Object.keys(extraPayload).forEach(function (key) {
    payload[key] = extraPayload[key];
  });

  var encoded = await encodePayload(payload);
  return buildHtml(title, buildBootScript(encoded));
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
  var html = await buildExportHtml("AGENTVIZ - " + filename, {
    session: { filename: filename, text: rawText },
  });
  var exportName = filename.replace(/\.jsonl$/, "") + "-agentviz.html";
  downloadHtml(html, exportName);
}

// Export a side-by-side comparison as a self-contained HTML file.
export async function exportComparison(rawTextA, filenameA, rawTextB, filenameB) {
  var html = await buildExportHtml("AGENTVIZ - Comparison", {
    compare: { a: { name: filenameA, text: rawTextA }, b: { name: filenameB, text: rawTextB } },
  });
  downloadHtml(html, "comparison-agentviz.html");
}
