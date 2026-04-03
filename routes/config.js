/**
 * Project configuration routes: surface detection, file preview, and apply.
 *
 * Handles:
 *   GET  /api/config    -- detect all config surfaces in the project
 *   GET  /api/read-file -- preview a single file before applying
 *   POST /api/apply     -- write/merge config content to disk
 */

import fs from "fs";
import path from "path";

var CONFIG_SURFACES = [
  { id: "claude-md",            path: "CLAUDE.md",                       glob: null,         skillDirs: false },
  { id: "copilot-instructions", path: ".github/copilot-instructions.md", glob: null,         skillDirs: false },
  { id: "agents-md",            path: "AGENTS.md",                       glob: null,         skillDirs: false },
  { id: "claude-agents",        path: ".claude/agents",                  glob: ".md",        skillDirs: false },
  { id: "claude-commands",      path: ".claude/commands",                glob: ".md",        skillDirs: false },
  { id: "claude-rules",         path: ".claude/rules",                   glob: ".md",        skillDirs: false },
  { id: "claude-skills",        path: ".claude/skills",                  glob: null,         skillDirs: false },
  { id: "mcp-json",             path: ".mcp.json",                       glob: null,         skillDirs: false },
  { id: "claude-settings",      path: ".claude/settings.json",           glob: null,         skillDirs: false },
  { id: "github-prompts",       path: ".github/prompts",                 glob: ".prompt.md", skillDirs: false },
  { id: "github-skills",        path: ".github/skills",                  glob: null,         skillDirs: true  },
  { id: "github-extensions",    path: ".github/extensions",              glob: ".yml",       skillDirs: false },
];

function validateProjectPath(filePath) {
  var cwd = process.cwd();
  var resolved = path.resolve(cwd, filePath);
  if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) return null;
  // Resolve symlinks to prevent escaping via symlink targets
  try {
    var real = fs.realpathSync(resolved);
    if (!real.startsWith(cwd + path.sep) && real !== cwd) return null;
    return real;
  } catch (e) {
    // File does not exist yet (e.g., new file creation via /api/apply)
    return resolved;
  }
}

export function handle(pathname, req, res, ctx) {

  if (pathname === "/api/config") {
    res.setHeader("Content-Type", "application/json");
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return true;
    }

    var cwd = process.cwd();
    var configResults = CONFIG_SURFACES.map(function (surface) {
      var resolvedPath = path.resolve(cwd, surface.path);

      if (surface.skillDirs) {
        try {
          var skillEntries = [];
          var subdirs = fs.readdirSync(resolvedPath, { withFileTypes: true });
          for (var si = 0; si < subdirs.length; si++) {
            if (!subdirs[si].isDirectory()) continue;
            var skillFile = path.join(resolvedPath, subdirs[si].name, "SKILL.md");
            try {
              var skillContent = fs.readFileSync(skillFile, "utf8");
              skillEntries.push({ path: path.join(surface.path, subdirs[si].name, "SKILL.md"), content: skillContent });
            } catch (e2) {}
          }
          return { id: surface.id, path: surface.path, exists: true, entries: skillEntries };
        } catch (e) {
          return { id: surface.id, path: surface.path, exists: false, entries: [] };
        }
      }

      if (surface.glob !== null) {
        try {
          var entries = [];
          var dirEntries = fs.readdirSync(resolvedPath);
          var ext = surface.glob.replace(/^\*/, "");
          for (var di = 0; di < dirEntries.length; di++) {
            var entryName = dirEntries[di];
            if (!entryName.endsWith(ext)) continue;
            try {
              var entryPath = path.join(surface.path, entryName);
              var entryContent = fs.readFileSync(path.resolve(cwd, entryPath), "utf8");
              entries.push({ path: entryPath, content: entryContent });
            } catch (e2) {}
          }
          return { id: surface.id, path: surface.path, exists: true, entries: entries };
        } catch (e) {
          return { id: surface.id, path: surface.path, exists: false, entries: [] };
        }
      }

      try {
        var fileContent = fs.readFileSync(resolvedPath, "utf8");
        var extra = {};
        if (surface.id === "mcp-json") {
          try {
            var mcpParsed = JSON.parse(fileContent);
            extra.mcpServers = Object.keys(mcpParsed.mcpServers || mcpParsed.servers || {});
          } catch (pe) {}
        }
        return Object.assign({ id: surface.id, path: surface.path, exists: true, content: fileContent }, extra);
      } catch (e) {
        return { id: surface.id, path: surface.path, exists: false, content: null };
      }
    });

    res.writeHead(200);
    res.end(JSON.stringify(configResults));
    return true;
  }

  if (pathname === "/api/read-file") {
    res.setHeader("Content-Type", "application/json");
    if (req.method !== "GET") { res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return true; }
    var qFilePath = ctx.parsed.query.path || "";
    if (!qFilePath) { res.writeHead(400); res.end(JSON.stringify({ error: "path is required" })); return true; }
    try {
      var qResolved = validateProjectPath(qFilePath);
      if (!qResolved) {
        res.writeHead(400); res.end(JSON.stringify({ error: "Path outside project" })); return true;
      }
      var qContent = null;
      try { qContent = fs.readFileSync(qResolved, "utf8"); } catch (e) {}
      res.writeHead(200);
      res.end(JSON.stringify({ exists: qContent !== null, content: qContent }));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  if (pathname === "/api/apply") {
    res.setHeader("Content-Type", "application/json");
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return true;
    }
    var body = "";
    req.on("data", function (chunk) { body += chunk; });
    req.on("end", function () {
      try {
        var payload = JSON.parse(body);
        var relativePath = payload.relativePath || payload.path;
        var content = payload.content;
        var mode = payload.mode || "auto";
        if (typeof relativePath !== "string" || !relativePath) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "path is required" }));
          return;
        }
        if (typeof content !== "string") {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "content is required" }));
          return;
        }
        var resolvedPath = validateProjectPath(relativePath);
        if (!resolvedPath) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Path outside project directory" }));
          return;
        }
        var parentDir = path.dirname(resolvedPath);
        fs.mkdirSync(parentDir, { recursive: true });
        var fileExists = false;
        var originalContent = null;
        try { originalContent = fs.readFileSync(resolvedPath, "utf8"); fileExists = true; } catch (e) {}

        if (!fileExists || mode === "overwrite") {
          fs.writeFileSync(resolvedPath, content, "utf8");
        } else if (relativePath.endsWith(".mcp.json") || relativePath === ".mcp.json") {
          try {
            var existing = JSON.parse(originalContent);
            var incoming = JSON.parse(content);
            var merged = Object.assign({}, existing);
            if (incoming.mcpServers) {
              merged.mcpServers = Object.assign({}, existing.mcpServers || {}, incoming.mcpServers);
            }
            fs.writeFileSync(resolvedPath, JSON.stringify(merged, null, 2), "utf8");
          } catch (e) {
            fs.appendFileSync(resolvedPath, "\n\n" + content, "utf8");
          }
        } else if (mode === "append" || relativePath.endsWith(".md")) {
          fs.appendFileSync(resolvedPath, "\n\n" + content, "utf8");
        } else {
          fs.appendFileSync(resolvedPath, "\n\n---\n\n" + content, "utf8");
        }
        var cwd = process.cwd();
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, path: path.relative(cwd, resolvedPath), originalContent: originalContent }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message || "Internal server error" }));
      }
    });
    return true;
  }

  return false;
}
