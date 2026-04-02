/**
 * Git Steering Route — serves repo evolution as Scribe-quality steering entries.
 *
 * Analyzes git log to extract steering moments, level-ups, milestones,
 * and pivots from the repo's history. Returns structured steering entries
 * with the timeline format the Scribe uses.
 *
 * Also manages the persistent steering log (.agentviz/steering-v{N}.jsonl)
 * with safety controls: redaction of secrets/PII, retention limits per file
 * (200 entries), versioned rotation, and opt-out via .agentviz/config.json.
 *
 * Handles:
 *   GET  /api/journal/git       — steering entries from git history
 *   GET  /api/journal/steering  — persisted steering entries from the log
 *   POST /api/journal/steering  — append a redacted steering entry to the log
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// ── Commit classification ────────────────────────────────────────────────────

var VERSION_RE = /^v?\d+\.\d+\.\d+/i;
var RELEASE_RE = /^(v?\d+\.\d+\.\d+|release\s)/i;
var FEAT_RE = /^feat[:(]/i;
var FIX_RE = /^fix[:(]/i;
var REFACTOR_RE = /^refactor[:(]/i;
var PERF_RE = /^perf[:(]/i;
var DOCS_RE = /^docs?[:(]/i;
var CHORE_RE = /^chore[:(]/i;
var CI_RE = /^ci[:(]/i;
var MERGE_RE = /^Merge /i;

function classifyCommit(message) {
  if (RELEASE_RE.test(message) || VERSION_RE.test(message)) return "release";
  if (FEAT_RE.test(message)) return "feat";
  if (FIX_RE.test(message)) return "fix";
  if (REFACTOR_RE.test(message)) return "refactor";
  if (PERF_RE.test(message)) return "perf";
  if (DOCS_RE.test(message)) return "docs";
  if (CHORE_RE.test(message) || CI_RE.test(message)) return "chore";
  if (MERGE_RE.test(message)) return "merge";
  return "other";
}

// ── Steering entry types ──────────────────────────────────────────────────────

function commitToSteeringType(classification, message) {
  if (classification === "release") return "milestone";
  if (classification === "feat") return "levelup";
  if (classification === "refactor") return "pivot";
  if (classification === "perf") return "levelup";
  if (classification === "fix") return "mistake";
  return null; // skip docs, chore, merge, ci for narrative purposes
}

// ── Narrative synthesis ──────────────────────────────────────────────────────

function synthesizeLevelUp(message, classification) {
  var cleaned = message.replace(/^(feat|fix|refactor|perf|docs|chore|ci|test)\s*[:(]\s*/i, "").replace(/\s*\(#\d+\)\s*$/, "").replace(/\)$/, "").trim();
  var short = cleaned.length > 50 ? cleaned.substring(0, 47) + "..." : cleaned;

  if (classification === "release") {
    var ver = message.match(/v?\d+\.\d+\.\d+/);
    return "📦 **" + (ver ? ver[0] + " shipped" : "Release shipped") + ".** Versioned milestone.";
  }
  if (classification === "feat") {
    return "✨ **" + short + ".** New capability.";
  }
  if (classification === "refactor") {
    return "🏗️ **Architecture improved.** " + short;
  }
  if (classification === "perf") {
    return "⚡ **Faster.** " + short;
  }
  if (classification === "fix") {
    return "🔧 **Fixed.** " + short;
  }
  return "📝 " + short;
}

function extractSteeringCommand(message) {
  // Strip conventional commit prefix to get the human intent
  var cleaned = message
    .replace(/^(feat|fix|refactor|perf|docs|chore|ci|test)\s*[:(]\s*/i, "")
    .replace(/\s*\(#\d+\)\s*$/, "") // strip PR number
    .replace(/\)$/, "")
    .trim();
  return cleaned || message;
}

// ── Author normalization ─────────────────────────────────────────────────────

var AUTHOR_MAP = {
  "Paul Yuknewicz": "paulyuk",
  "dependabot[bot]": "dependabot",
};

function normalizeAuthor(name) {
  return AUTHOR_MAP[name] || name;
}

// ── Git log parsing ──────────────────────────────────────────────────────────

function parseGitLog(repoDir) {
  try {
    var raw = execSync(
      "git log --format=\"%H|%aI|%an|%s\" --all -100",
      { cwd: repoDir, encoding: "utf8", timeout: 5000 }
    );
    var commits = raw.trim().split("\n").filter(Boolean).map(function (line) {
      var parts = line.split("|");
      return {
        hash: parts[0],
        date: parts[1],
        author: normalizeAuthor(parts[2]),
        message: parts.slice(3).join("|"),
        linesChanged: 0,
      };
    });

    // Second pass: get lines changed per commit (batch for performance)
    try {
      var statRaw = execSync(
        "git log --format=\"COMMIT:%H\" --shortstat --all -100",
        { cwd: repoDir, encoding: "utf8", timeout: 8000 }
      );
      var currentHash = null;
      statRaw.split("\n").forEach(function (line) {
        if (line.startsWith("COMMIT:")) {
          currentHash = line.substring(7).trim();
        } else if (currentHash && line.indexOf("changed") !== -1) {
          var ins = line.match(/(\d+) insertion/);
          var del = line.match(/(\d+) deletion/);
          var total = (ins ? parseInt(ins[1]) : 0) + (del ? parseInt(del[1]) : 0);
          var commit = commits.find(function (c) { return c.hash === currentHash; });
          if (commit) commit.linesChanged = total;
          currentHash = null;
        }
      });
    } catch (e) {
      // stat pass failed, linesChanged stays 0
    }

    return commits;
  } catch (e) {
    return [];
  }
}

function getRepoName(repoDir) {
  try {
    var remote = execSync("git remote get-url origin", {
      cwd: repoDir, encoding: "utf8", timeout: 3000,
    }).trim();
    var match = remote.match(/\/([^/]+?)(?:\.git)?$/);
    return match ? match[1] : path.basename(repoDir);
  } catch (e) {
    return path.basename(repoDir);
  }
}

function getContributorCount(repoDir) {
  try {
    var raw = execSync("git shortlog -sn --all", {
      cwd: repoDir, encoding: "utf8", timeout: 3000,
    }).trim();
    return raw.split("\n").filter(Boolean).length;
  } catch (e) {
    return 0;
  }
}

// ── Main extraction ──────────────────────────────────────────────────────────

function extractGitSteering(repoDir) {
  var commits = parseGitLog(repoDir);
  if (commits.length === 0) return { entries: [], repo: null };

  var repoName = getRepoName(repoDir);
  var contributors = getContributorCount(repoDir);

  var entries = [];
  var releaseCount = 0;
  var featCount = 0;
  var fixCount = 0;
  var refactorArc = [];

  commits.forEach(function (commit) {
    var classification = classifyCommit(commit.message);
    var steeringType = commitToSteeringType(classification, commit.message);

    if (!steeringType) return; // skip non-narrative commits

    if (classification === "release") releaseCount++;
    if (classification === "feat") featCount++;
    if (classification === "fix") fixCount++;

    // Track refactoring arcs (consecutive refactors)
    if (classification === "refactor") {
      refactorArc.push(commit);
    } else {
      if (refactorArc.length >= 3) {
        // Collapse refactoring arc into a single pivot entry
        // Use last element — git log is newest-first, so last = chronologically earliest
        var arcAnchor = refactorArc[refactorArc.length - 1];
        entries.push({
          type: "pivot",
          time: arcAnchor.date,
          hash: arcAnchor.hash,
          author: arcAnchor.author,
          steeringCommand: refactorArc.length + "-phase refactoring initiative",
          whatHappened: refactorArc.map(function (c) {
            return extractSteeringCommand(c.message);
          }).join(" → "),
          levelUp: "Architecture leveled up through disciplined multi-phase refactoring — not a rewrite, but a careful evolution",
          commitCount: refactorArc.length,
          linesChanged: refactorArc.reduce(function (s, c) { return s + (c.linesChanged || 0); }, 0),
        });
      } else {
        // Individual refactors
        refactorArc.forEach(function (rc) {
          entries.push({
            type: "pivot",
            time: rc.date,
            hash: rc.hash,
            author: rc.author,
            steeringCommand: extractSteeringCommand(rc.message),
            whatHappened: rc.message,
            levelUp: synthesizeLevelUp(rc.message, "refactor"),
          });
        });
      }
      refactorArc = [];
    }

    if (classification !== "refactor") {
      entries.push({
        type: steeringType,
        time: commit.date,
        hash: commit.hash,
        author: commit.author,
        steeringCommand: extractSteeringCommand(commit.message),
        whatHappened: commit.message,
        levelUp: synthesizeLevelUp(commit.message, classification),
        linesChanged: commit.linesChanged || 0,
      });
    }
  });

  // Flush any remaining refactor arc
  if (refactorArc.length >= 3) {
    var flushAnchor = refactorArc[refactorArc.length - 1];
    entries.push({
      type: "pivot",
      time: flushAnchor.date,
      hash: flushAnchor.hash,
      author: flushAnchor.author,
      steeringCommand: refactorArc.length + "-phase refactoring initiative",
      whatHappened: refactorArc.map(function (c) {
        return extractSteeringCommand(c.message);
      }).join(" → "),
      levelUp: "Architecture leveled up through disciplined multi-phase refactoring",
      commitCount: refactorArc.length,
    });
  } else {
    refactorArc.forEach(function (rc) {
      entries.push({
        type: "pivot",
        time: rc.date,
        hash: rc.hash,
        author: rc.author,
        steeringCommand: extractSteeringCommand(rc.message),
        whatHappened: rc.message,
        levelUp: synthesizeLevelUp(rc.message, "refactor"),
      });
    });
  }

  // Sort chronologically (git log is newest-first, plus timezone offsets need Date parsing)
  entries.sort(function (a, b) {
    return new Date(a.time).getTime() - new Date(b.time).getTime();
  });

  return {
    entries: entries,
    repo: {
      name: repoName,
      totalCommits: commits.length,
      contributors: contributors,
      releases: releaseCount,
      features: featCount,
      fixes: fixCount,
      firstCommit: commits[commits.length - 1] ? commits[commits.length - 1].date : null,
      latestCommit: commits[0] ? commits[0].date : null,
    },
  };
}

// ── Route handler ────────────────────────────────────────────────────────────

// ── Persistent steering log with safety controls ─────────────────────────────

var MAX_ENTRIES_PER_FILE = 200;
var CURRENT_LOG_VERSION = 1;

function getSteeringDir(repoDir) {
  return path.join(repoDir, ".agentviz");
}

function getSteeringLogPath(repoDir, version) {
  version = version || CURRENT_LOG_VERSION;
  return path.join(getSteeringDir(repoDir), "steering-v" + version + ".jsonl");
}

function getSteeringConfig(repoDir) {
  try {
    var configPath = path.join(getSteeringDir(repoDir), "config.json");
    var raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function isSteeringEnabled(repoDir) {
  var config = getSteeringConfig(repoDir);
  return config.steering !== false; // enabled by default, explicit false to disable
}

// ── Redaction — strip secrets before persisting ──────────────────────────────

var SECRET_PATTERNS = [
  /\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{16,}\b/g,  // GitHub tokens
  /\b(sk-|pk_live_|pk_test_|sk_live_|sk_test_)[A-Za-z0-9]{20,}\b/g, // API keys
  /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,                           // AWS keys
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,                          // Base64 blobs (likely keys)
  /\bey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, // JWTs
  /\b(password|secret|token|key|credential)\s*[=:]\s*\S+/gi, // key=value secrets
  /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,   // emails
];

var HOME_RE = null;

function getHomeRegex() {
  if (HOME_RE) return HOME_RE;
  try {
    var home = process.env.HOME || process.env.USERPROFILE || "";
    if (home) {
      HOME_RE = new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    }
  } catch (e) {}
  return HOME_RE;
}

function redact(text) {
  if (!text || typeof text !== "string") return text;
  var result = text;

  // Strip secrets
  SECRET_PATTERNS.forEach(function (pat) {
    result = result.replace(pat, "[REDACTED]");
  });

  // Strip home directory paths
  var homeRe = getHomeRegex();
  if (homeRe) {
    result = result.replace(homeRe, "~");
  }

  return result;
}

function redactEntry(entry) {
  return {
    type: entry.type,
    time: entry.time,
    steeringCommand: redact(entry.steeringCommand),
    whatHappened: redact(entry.whatHappened),
    levelUp: redact(entry.levelUp),
  };
}

// ── Read/write with versioning and retention ─────────────────────────────────

function readSteeringLog(repoDir) {
  // Read current version first, then older versions
  var allEntries = [];
  for (var v = CURRENT_LOG_VERSION; v >= 1; v--) {
    var logPath = getSteeringLogPath(repoDir, v);
    try {
      var raw = fs.readFileSync(logPath, "utf8");
      var entries = raw.trim().split("\n").filter(Boolean).map(function (line) {
        try { return JSON.parse(line); } catch (e) { return null; }
      }).filter(Boolean);
      allEntries = allEntries.concat(entries);
    } catch (e) {
      // File doesn't exist, skip
    }
  }
  return allEntries;
}

function appendSteeringEntry(repoDir, entry) {
  var dir = getSteeringDir(repoDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  var logPath = getSteeringLogPath(repoDir, CURRENT_LOG_VERSION);

  // Check retention: if current file has MAX_ENTRIES, rotate
  try {
    var existing = fs.readFileSync(logPath, "utf8");
    var lineCount = existing.trim().split("\n").filter(Boolean).length;
    if (lineCount >= MAX_ENTRIES_PER_FILE) {
      // Rotate: bump version number by renaming current to v(N+1)
      var nextVersion = CURRENT_LOG_VERSION + 1;
      var archivePath = getSteeringLogPath(repoDir, nextVersion);
      // Don't overwrite existing archives
      if (!fs.existsSync(archivePath)) {
        fs.renameSync(logPath, archivePath);
      }
    }
  } catch (e) {
    // File doesn't exist yet, that's fine
  }

  // Redact and write
  var safe = redactEntry(entry);
  var line = JSON.stringify(Object.assign({
    contributedAt: new Date().toISOString(),
    logVersion: CURRENT_LOG_VERSION,
  }, safe)) + "\n";
  fs.appendFileSync(logPath, line);
}

export function handle(pathname, req, res, ctx) {
  // Commit files route
  if (pathname === "/api/journal/commit-files") {
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end("Method not allowed");
      return true;
    }
    try {
      var url = require("url");
      var parsed = url.parse(req.url, true);
      var hash = (parsed.query.hash || "").replace(/[^a-f0-9]/gi, "").substring(0, 40);
      if (!hash) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "hash required" }));
        return true;
      }
      var raw = execSync(
        "git show --stat --format='' " + hash,
        { cwd: process.cwd(), encoding: "utf8", timeout: 3000 }
      );
      var files = raw.trim().split("\n").filter(function (line) {
        return line.indexOf("|") !== -1;
      }).map(function (line) {
        return line.split("|")[0].trim();
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ files: files }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ files: [] }));
    }
    return true;
  }

  // Git history route
  if (pathname === "/api/journal/git") {
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end("Method not allowed");
      return true;
    }
    try {
      var repoDir = process.cwd();
      var result = extractGitSteering(repoDir);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // Persistent steering log routes
  if (pathname === "/api/journal/steering") {
    if (req.method === "GET") {
      try {
        var entries = readSteeringLog(process.cwd());
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ entries: entries }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
      return true;
    }

    if (req.method === "POST") {
      if (!isSteeringEnabled(process.cwd())) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "steering disabled in .agentviz/config.json" }));
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var entry = JSON.parse(body);
          if (!entry.steeringCommand || !entry.type) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "steeringCommand and type are required" }));
            return;
          }
          appendSteeringEntry(process.cwd(), entry);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    res.writeHead(405);
    res.end("Method not allowed");
    return true;
  }

  return false;
}
