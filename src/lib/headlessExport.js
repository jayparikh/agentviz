import fs from "fs/promises";
import path from "path";

function jsonSafe(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function scriptSafeText(value) {
  return jsonSafe(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function toUrlPath(value) {
  return value.replace(/\\/g, "/");
}

function resolveSessionPath(manifestPath, sessionUrl) {
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(sessionUrl)) {
    throw new Error("Cannot embed remote session URL: " + sessionUrl);
  }
  return path.resolve(path.dirname(manifestPath), sessionUrl);
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function readManifestWithSessions(manifestPath) {
  var resolvedManifestPath = path.resolve(manifestPath);
  var manifest = JSON.parse(await readText(resolvedManifestPath));
  if (!manifest || !Array.isArray(manifest.sessions)) {
    throw new Error("Manifest must contain a sessions array: " + resolvedManifestPath);
  }

  var sessionTexts = {};
  for (var i = 0; i < manifest.sessions.length; i++) {
    var session = manifest.sessions[i];
    if (!session || !session.url) continue;
    var normalizedUrl = toUrlPath(session.url);
    var sessionPath = resolveSessionPath(resolvedManifestPath, normalizedUrl);
    sessionTexts["data/" + normalizedUrl] = await readText(sessionPath);
  }

  return { manifest: manifest, sessionTexts: sessionTexts };
}

function findMainScript(indexHtml) {
  var match = indexHtml.match(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/);
  if (!match) {
    throw new Error("Could not find production module script in dist/index.html");
  }
  return match[1];
}

async function readAssetSources(distDir, mainScriptSrc) {
  var assetsDir = path.join(distDir, "assets");
  var entries = await fs.readdir(assetsDir, { withFileTypes: true });
  var sources = {};

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    sources[entry.name] = await readText(path.join(assetsDir, entry.name));
  }

  var mainName = path.basename(mainScriptSrc);
  if (!sources[mainName]) {
    throw new Error("Could not find main bundle asset: " + mainName);
  }

  return { mainName: mainName, sources: sources };
}

function buildSetupScript(manifest, sessionTexts) {
  return "<script>\n" +
    "(function() {\n" +
    "  var manifest = " + jsonSafe(manifest) + ";\n" +
    "  var sessions = " + jsonSafe(sessionTexts) + ";\n" +
    "  var url = new URL(window.location.href);\n" +
    "  if (!url.searchParams.has('manifest')) {\n" +
    "    url.searchParams.set('manifest', 'data/manifest.json');\n" +
    "    window.history.replaceState(null, '', url.href);\n" +
    "  }\n" +
    "  function keyFor(input) {\n" +
    "    var raw = String(input && input.url ? input.url : input);\n" +
    "    if (raw === 'data/manifest.json') return raw;\n" +
    "    if (raw.indexOf('data/') === 0) return raw;\n" +
    "    try {\n" +
    "      var parsed = new URL(raw, window.location.href);\n" +
    "      var pathname = decodeURIComponent(parsed.pathname).replace(/\\\\/g, '/');\n" +
    "      var dataIndex = pathname.lastIndexOf('/data/');\n" +
    "      if (dataIndex >= 0) return pathname.slice(dataIndex + 1);\n" +
    "    } catch (e) {}\n" +
    "    return raw;\n" +
    "  }\n" +
    "  var originalFetch = window.fetch ? window.fetch.bind(window) : null;\n" +
    "  window.fetch = function(input, init) {\n" +
    "    var key = keyFor(input);\n" +
    "    if (key === 'data/manifest.json') {\n" +
    "      return Promise.resolve(new Response(JSON.stringify(manifest), { status: 200, headers: { 'Content-Type': 'application/json' } }));\n" +
    "    }\n" +
    "    if (Object.prototype.hasOwnProperty.call(sessions, key)) {\n" +
    "      return Promise.resolve(new Response(sessions[key], { status: 200, headers: { 'Content-Type': 'text/plain' } }));\n" +
    "    }\n" +
    "    if (!originalFetch) return Promise.reject(new Error('No fetch handler for ' + key));\n" +
    "    return originalFetch(input, init);\n" +
    "  };\n" +
    "}());\n" +
    "</" + "script>";
}

function buildBundleBootstrap(mainName, sources) {
  return "<script>\n" +
    "(function() {\n" +
    "  var sources = " + scriptSafeText(sources) + ";\n" +
    "  var mainName = " + jsonSafe(mainName) + ";\n" +
    "  var urls = {};\n" +
    "  var workerNames = Object.keys(sources).filter(function(name) { return /worker/i.test(name); });\n" +
    "  workerNames.forEach(function(name) {\n" +
    "    urls[name] = URL.createObjectURL(new Blob([sources[name]], { type: 'text/javascript' }));\n" +
    "  });\n" +
    "  var mainSource = sources[mainName]\n" +
    "    .replace(/import\\(\\\"\\.\\/([^\\\"]+\\.js)\\\"\\)/g, 'import(window.__AGENTVIZ_ASSET_URLS__[\"$1\"])');\n" +
    "  urls[mainName] = URL.createObjectURL(new Blob([mainSource], { type: 'text/javascript' }));\n" +
    "  Object.keys(sources).forEach(function(name) {\n" +
    "    if (name === mainName || urls[name]) return;\n" +
    "    var source = sources[name]\n" +
    "      .replace(/from\\\"\\.\\/([^\\\"]+\\.js)\\\"/g, function(_match, dep) {\n" +
    "        if (dep === mainName) return 'from \"' + urls[mainName] + '\"';\n" +
    "        return 'from \"' + (urls[dep] || dep) + '\"';\n" +
    "      })\n" +
    "      .replace(/new URL\\(\\\"\\\"\\+new URL\\(\\\"([^\\\"]*worker[^\\\"]*\\.js)\\\",import\\.meta\\.url\\)\\.href,import\\.meta\\.url\\)/g, function(_match, dep) {\n" +
    "        return 'window.__AGENTVIZ_ASSET_URLS__[\"' + dep + '\"]';\n" +
    "      });\n" +
    "    urls[name] = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));\n" +
    "  });\n" +
    "  window.__AGENTVIZ_ASSET_URLS__ = urls;\n" +
    "  import(urls[mainName]);\n" +
    "}());\n" +
    "</" + "script>";
}

function buildSelfContainedHtml(indexHtml, mainScriptSrc, setupScript, bootstrapScript) {
  var withoutModuleScript = indexHtml.replace(
    /<script\b[^>]*type=["']module["'][^>]*src=["'][^"']+["'][^>]*>\s*<\/script>/,
    ""
  );
  var injection = setupScript + "\n" + bootstrapScript;
  if (withoutModuleScript.includes("</body>")) {
    return withoutModuleScript.replace("</body>", injection + "\n</body>");
  }
  return withoutModuleScript + "\n" + injection + "\n";
}

export async function buildSelfContainedManifestHtml(options) {
  if (!options || !options.manifestPath) throw new Error("manifestPath is required");
  if (!options.distDir) throw new Error("distDir is required");

  var distDir = path.resolve(options.distDir);
  var indexHtml = await readText(path.join(distDir, "index.html"));
  var mainScriptSrc = findMainScript(indexHtml);
  var bundle = await readAssetSources(distDir, mainScriptSrc);
  var manifestData = await readManifestWithSessions(options.manifestPath);
  var setupScript = buildSetupScript(manifestData.manifest, manifestData.sessionTexts);
  var bootstrapScript = buildBundleBootstrap(bundle.mainName, bundle.sources);
  return buildSelfContainedHtml(indexHtml, mainScriptSrc, setupScript, bootstrapScript);
}

export async function writeSelfContainedManifestHtml(options) {
  if (!options || !options.outPath) throw new Error("outPath is required");
  var html = await buildSelfContainedManifestHtml(options);
  await fs.mkdir(path.dirname(path.resolve(options.outPath)), { recursive: true });
  await fs.writeFile(options.outPath, html, "utf8");
}
