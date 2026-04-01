/**
 * Git Journal Route — serves repo evolution as Scribe-quality journal entries.
 *
 * Analyzes git log to extract steering moments, level-ups, milestones,
 * and pivots from the repo's history. Returns structured journal entries
 * with the timeline format the Scribe uses.
 *
 * Handles:
 *   GET /api/journal/git  — returns journal entries from git history
 */

import { execSync } from "child_process";
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

// ── Journal entry types ──────────────────────────────────────────────────────

function commitToJournalType(classification, message) {
  if (classification === "release") return "milestone";
  if (classification === "feat") return "levelup";
  if (classification === "refactor") return "pivot";
  if (classification === "perf") return "levelup";
  if (classification === "fix") return "mistake";
  return null; // skip docs, chore, merge, ci for narrative purposes
}

// ── Narrative synthesis ──────────────────────────────────────────────────────

function synthesizeLevelUp(message, classification) {
  if (classification === "release") {
    var ver = message.match(/v?\d+\.\d+\.\d+/);
    return "Shipped " + (ver ? ver[0] : "a release") + " — a versioned milestone the community can depend on";
  }
  if (classification === "feat") {
    return "New capability unlocked — the product can now do something it couldn't before";
  }
  if (classification === "refactor") {
    return "Codebase leveled up — cleaner architecture enables faster future work";
  }
  if (classification === "perf") {
    return "Performance breakthrough — users experience a faster, smoother tool";
  }
  if (classification === "fix") {
    return "Bug squashed — reliability improved through honest failure acknowledgment";
  }
  return "Progress made";
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

// ── Git log parsing ──────────────────────────────────────────────────────────

function parseGitLog(repoDir) {
  try {
    var raw = execSync(
      "git log --format=\"%H|%aI|%an|%s\" --all -100",
      { cwd: repoDir, encoding: "utf8", timeout: 5000 }
    );
    return raw.trim().split("\n").filter(Boolean).map(function (line) {
      var parts = line.split("|");
      return {
        hash: parts[0],
        date: parts[1],
        author: parts[2],
        message: parts.slice(3).join("|"),
      };
    });
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

function extractGitJournal(repoDir) {
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
    var journalType = commitToJournalType(classification, commit.message);

    if (!journalType) return; // skip non-narrative commits

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
        type: journalType,
        time: commit.date,
        hash: commit.hash,
        author: commit.author,
        steeringCommand: extractSteeringCommand(commit.message),
        whatHappened: commit.message,
        levelUp: synthesizeLevelUp(commit.message, classification),
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

export function handle(pathname, req, res, ctx) {
  if (pathname !== "/api/journal/git") return false;

  if (req.method !== "GET") {
    res.writeHead(405);
    res.end("Method not allowed");
    return true;
  }

  try {
    var repoDir = process.cwd();
    var result = extractGitJournal(repoDir);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  }

  return true;
}
