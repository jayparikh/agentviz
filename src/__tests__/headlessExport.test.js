import { describe, it, expect, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import {
  buildSelfContainedManifestHtml,
  writeSelfContainedManifestHtml,
} from "../lib/headlessExport.js";

var tempRoots = [];
var repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

afterEach(async function () {
  await Promise.all(tempRoots.map(function (root) {
    return fs.rm(root, { recursive: true, force: true });
  }));
  tempRoots = [];
});

async function makeTempRoot() {
  var root = await fs.mkdtemp(path.join(os.tmpdir(), "agentviz-headless-export-"));
  tempRoots.push(root);
  return root;
}

async function createFixture() {
  var root = await makeTempRoot();
  var distDir = path.join(root, "dist");
  var assetsDir = path.join(distDir, "assets");
  var dataDir = path.join(root, "data");
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.mkdir(path.join(dataDir, "sessions"), { recursive: true });

  await fs.writeFile(path.join(distDir, "index.html"), [
    "<!doctype html>",
    "<html>",
    "<head>",
    "  <title>AGENTVIZ</title>",
    "  <script type=\"module\" crossorigin src=\"./assets/index-main.js\"></script>",
    "</head>",
    "<body><div id=\"root\"></div></body>",
    "</html>",
  ].join("\n"));
  await fs.writeFile(
    path.join(assetsDir, "index-main.js"),
    "console.log('main'); import(\"./GraphView.js\"); fetch('data/manifest.json');\n"
  );
  await fs.writeFile(
    path.join(assetsDir, "GraphView.js"),
    "import { x } from \"./index-main.js\"; console.log('graph', x, new URL(\"\"+new URL(\"elk-worker.js\",import.meta.url).href,import.meta.url));\n"
  );
  await fs.writeFile(path.join(assetsDir, "elk-worker.js"), "self.onmessage = function() {};\n");
  await fs.writeFile(
    path.join(dataDir, "manifest.json"),
    JSON.stringify({
      generated: "2026-04-28T00:00:00Z",
      sessions: [
        {
          id: "one",
          name: "Session One",
          url: "sessions/one.jsonl",
          tags: ["test"],
          mtime: 1,
        },
      ],
    })
  );
  await fs.writeFile(
    path.join(dataDir, "sessions", "one.jsonl"),
    "{\"type\":\"session.start\",\"producer\":\"copilot-agent\"}\n"
  );

  return {
    root: root,
    distDir: distDir,
    manifestPath: path.join(dataDir, "manifest.json"),
  };
}

describe("headless HTML export", function () {
  it("builds a self-contained manifest report", async function () {
    var fixture = await createFixture();
    var html = await buildSelfContainedManifestHtml({
      manifestPath: fixture.manifestPath,
      distDir: fixture.distDir,
    });

    expect(html).toContain("Session One");
    expect(html).toContain("session.start");
    expect(html).toContain("window.fetch = function");
    expect(html).toContain("window.__AGENTVIZ_ASSET_URLS__");
    expect(html).toContain("import(window.__AGENTVIZ_ASSET_URLS__");
    expect(html).toContain("URL.createObjectURL");
    expect(html).not.toContain("src=\"./assets/index-main.js\"");
  });

  it("embeds payloads with replacement-string tokens literally", async function () {
    var fixture = await createFixture();
    await fs.writeFile(
      path.join(fixture.root, "data", "sessions", "one.jsonl"),
      "{\"type\":\"message\",\"content\":\"Regex anchors: ^/$` and match token $&\"}\n"
    );

    var html = await buildSelfContainedManifestHtml({
      manifestPath: fixture.manifestPath,
      distDir: fixture.distDir,
    });

    expect(html.match(/<!doctype html>/g)).toHaveLength(1);
    expect(html).toContain("^/$` and match token $\\u0026");
  });

  it("writes a self-contained report file", async function () {
    var fixture = await createFixture();
    var outPath = path.join(fixture.root, "report.html");

    await writeSelfContainedManifestHtml({
      manifestPath: fixture.manifestPath,
      distDir: fixture.distDir,
      outPath: outPath,
    });

    var html = await fs.readFile(outPath, "utf8");
    expect(html).toContain("Session One");
  });

  it("rejects remote session URLs", async function () {
    var fixture = await createFixture();
    await fs.writeFile(
      fixture.manifestPath,
      JSON.stringify({ sessions: [{ url: "https://example.com/session.jsonl" }] })
    );

    await expect(buildSelfContainedManifestHtml({
      manifestPath: fixture.manifestPath,
      distDir: fixture.distDir,
    })).rejects.toThrow("Cannot embed remote session URL");
  });

  it("supports the agentviz export CLI", async function () {
    var fixture = await createFixture();
    var outPath = path.join(fixture.root, "cli-report.html");
    await new Promise(function (resolve, reject) {
      execFile(
        process.execPath,
        [
          path.join(repoRoot, "bin", "agentviz.js"),
          "export",
          "--manifest",
          fixture.manifestPath,
          "--out",
          outPath,
        ],
        {
          cwd: repoRoot,
          env: Object.assign({}, process.env, {
            AGENTVIZ_EXPORT_DIST_DIR: fixture.distDir,
          }),
        },
        function (error, stdout, stderr) {
          if (error) {
            error.message += "\nstdout:\n" + stdout + "\nstderr:\n" + stderr;
            reject(error);
            return;
          }
          resolve();
        }
      );
    });

    var html = await fs.readFile(outPath, "utf8");
    expect(html).toContain("Session One");
  });
});
