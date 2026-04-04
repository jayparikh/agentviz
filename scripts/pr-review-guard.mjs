#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";

var MARKER = "<!-- agentviz-pr-review-digest -->";
var UI_PATH_PREFIXES = ["src/components/"];
var UI_EXACT_PATHS = new Set(["src/App.jsx"]);
var DOC_PATHS = {
  readme: "README.md",
  styleGuide: "docs/ui-ux-style-guide.md",
  screenshotsPrefix: "docs/screenshots/",
};
var HARDCODED_COLOR_ALLOWLIST = new Set([
  "src/components/CompareView.jsx",
  "src/components/LiveIndicator.jsx",
]);
var HEX_COLOR_RE = /#[0-9a-fA-F]{3,8}\b/g;

function parseArgs(argv) {
  var options = { base: "main", head: "HEAD" };
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === "--base" && argv[i + 1]) {
      options.base = argv[i + 1];
      i++;
    } else if (argv[i] === "--head" && argv[i + 1]) {
      options.head = argv[i + 1];
      i++;
    }
  }
  return options;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trimEnd();
}

function safeGit(args) {
  try {
    return git(args);
  } catch (_error) {
    return "";
  }
}

function listUntrackedFiles() {
  var output = safeGit(["ls-files", "--others", "--exclude-standard"]);
  return output ? output.split("\n").filter(Boolean) : [];
}

function countFileLines(path) {
  try {
    var text = fs.readFileSync(path, "utf8");
    if (!text) return 0;
    return text.split("\n").length;
  } catch (_error) {
    return 0;
  }
}

function pluralize(count, singular, plural) {
  return count === 1 ? singular : (plural || singular + "s");
}

function classifyFile(path) {
  if (UI_PATH_PREFIXES.some(function (prefix) { return path.startsWith(prefix); }) || UI_EXACT_PATHS.has(path)) return "ui";
  if (/^src\/lib\/.*(parser|parse|extractor)/i.test(path)) return "parser";
  if (path.startsWith("routes/") || path === "server.js") return "server";
  if (path.startsWith(".github/")) return "workflow";
  if (path.includes("__tests__/")) return "tests";
  if (path === DOC_PATHS.readme || path === DOC_PATHS.styleGuide || path.startsWith(DOC_PATHS.screenshotsPrefix)) return "docs";
  return "other";
}

function readChangedFiles(base, head) {
  var committed = safeGit(["diff", "--name-only", base + "..." + head]);
  var worktree = safeGit(["diff", "--name-only", head]);
  var untracked = listUntrackedFiles();
  return Array.from(new Set(
    []
      .concat(committed ? committed.split("\n").filter(Boolean) : [])
      .concat(worktree ? worktree.split("\n").filter(Boolean) : [])
      .concat(untracked)
  ));
}

function readDiffStats(base, head) {
  var committed = safeGit(["diff", "--numstat", base + "..." + head]);
  var worktree = safeGit(["diff", "--numstat", head]);
  var stats = []
    .concat(committed ? committed.split("\n").filter(Boolean) : [])
    .concat(worktree ? worktree.split("\n").filter(Boolean) : [])
    .reduce(function (acc, line) {
      var parts = line.split("\t");
      var added = Number(parts[0]);
      var removed = Number(parts[1]);
      if (!Number.isNaN(added)) acc.additions += added;
      if (!Number.isNaN(removed)) acc.deletions += removed;
      return acc;
    }, { additions: 0, deletions: 0 });
  listUntrackedFiles().forEach(function (path) {
    stats.additions += countFileLines(path);
  });
  return stats;
}

function readHardcodedColorViolations(base, head) {
  var committed = safeGit(["diff", "--unified=0", base + "..." + head, "--", "src/components"]);
  var worktree = safeGit(["diff", "--unified=0", head, "--", "src/components"]);
  var diff = [committed, worktree].filter(Boolean).join("\n");
  if (!diff) return [];

  var violations = [];
  var currentFile = null;
  var currentLine = 0;

  diff.split("\n").forEach(function (line) {
    if (line.startsWith("diff --git ")) {
      var match = line.match(/ b\/(.+)$/);
      currentFile = match ? match[1] : null;
      currentLine = 0;
      return;
    }
    if (!currentFile || HARDCODED_COLOR_ALLOWLIST.has(currentFile)) return;
    if (line.startsWith("@@")) {
      var hunk = line.match(/\+(\d+)/);
      currentLine = hunk ? Number(hunk[1]) : 0;
      return;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) return;
    if (line.startsWith("+")) {
      var colors = line.match(HEX_COLOR_RE) || [];
      if (colors.length > 0) {
        violations.push({
          file: currentFile,
          line: currentLine,
          colors: Array.from(new Set(colors)),
          text: line.slice(1).trim(),
        });
      }
      currentLine += 1;
      return;
    }
    if (line.startsWith(" ")) currentLine += 1;
  });

  return violations;
}

function buildDigest(data) {
  var blastRadius = [];
  if (data.hasUiChanges) blastRadius.push("UI");
  if (data.hasParserChanges) blastRadius.push("parser/data");
  if (data.hasServerChanges) blastRadius.push("server/routes");
  if (data.hasWorkflowChanges) blastRadius.push("workflow");
  if (data.hasDocsChanges) blastRadius.push("docs");
  if (blastRadius.length === 0) blastRadius.push("other");

  var riskFlags = [];
  if (data.changedFiles.length >= 8 || data.stats.additions + data.stats.deletions >= 600) riskFlags.push("large PR");
  if (data.hasUiChanges && data.hasParserChanges) riskFlags.push("mixed UI + parser");
  if (data.uiSyncMissing.length > 0) riskFlags.push("missing UI sync");
  if (!data.hasTestsChanges && (data.hasParserChanges || data.hasServerChanges)) riskFlags.push("no test changes");
  if (data.hardcodedColors.length > 0) riskFlags.push("new hardcoded colors");
  if (riskFlags.length === 0) riskFlags.push("none");

  var recommendation = "Ready for review.";
  if (data.uiSyncMissing.length > 0 || data.hardcodedColors.length > 0) {
    recommendation = "Request changes before deep review.";
  } else if (riskFlags.includes("large PR") || riskFlags.includes("mixed UI + parser")) {
    recommendation = "Needs careful manual review.";
  }

  var lines = [
    MARKER,
    "## PR review digest",
    "",
    "- **Blast radius:** " + blastRadius.join(", "),
    "- **Size:** " + data.changedFiles.length + " " + pluralize(data.changedFiles.length, "file") + ", +" + data.stats.additions + "/-" + data.stats.deletions,
    "- **Tests touched:** " + (data.hasTestsChanges ? "yes" : "no"),
    "- **Recommendation:** " + recommendation,
    "",
    "### Policy signals",
    "",
    "| Check | Status |",
    "| --- | --- |",
    "| UI four-artifact sync | " + (data.hasUiChanges ? (data.uiSyncMissing.length === 0 ? "pass" : "missing " + data.uiSyncMissing.join(", ")) : "not applicable") + " |",
    "| Hardcoded color check | " + (data.hardcodedColors.length === 0 ? "pass" : data.hardcodedColors.length + " violation" + (data.hardcodedColors.length === 1 ? "" : "s")) + " |",
    "| Risk flags | " + riskFlags.join(", ") + " |",
    "",
  ];

  if (data.hardcodedColors.length > 0) {
    lines.push("### Hardcoded color violations", "");
    data.hardcodedColors.slice(0, 10).forEach(function (violation) {
      lines.push("- `" + violation.file + ":" + violation.line + "` added " + violation.colors.join(", "));
    });
    lines.push("");
  }

  lines.push("### Changed files", "");
  data.changedFiles.slice(0, 15).forEach(function (path) {
    lines.push("- `" + path + "`");
  });
  if (data.changedFiles.length > 15) {
    lines.push("- ... and " + (data.changedFiles.length - 15) + " more");
  }

  return lines.join("\n");
}

function main() {
  var options = parseArgs(process.argv.slice(2));
  var changedFiles = readChangedFiles(options.base, options.head);
  var stats = readDiffStats(options.base, options.head);
  var hardcodedColors = readHardcodedColorViolations(options.base, options.head);

  var hasUiChanges = changedFiles.some(function (path) { return classifyFile(path) === "ui"; });
  var hasParserChanges = changedFiles.some(function (path) { return classifyFile(path) === "parser"; });
  var hasServerChanges = changedFiles.some(function (path) { return classifyFile(path) === "server"; });
  var hasWorkflowChanges = changedFiles.some(function (path) { return classifyFile(path) === "workflow"; });
  var hasDocsChanges = changedFiles.some(function (path) { return classifyFile(path) === "docs"; });
  var hasTestsChanges = changedFiles.some(function (path) { return classifyFile(path) === "tests"; });

  var uiSyncMissing = [];
  if (hasUiChanges) {
    if (!changedFiles.includes(DOC_PATHS.readme)) uiSyncMissing.push("README");
    if (!changedFiles.includes(DOC_PATHS.styleGuide)) uiSyncMissing.push("style guide");
    if (!changedFiles.some(function (path) { return path.startsWith(DOC_PATHS.screenshotsPrefix); })) uiSyncMissing.push("screenshots");
  }

  var digest = buildDigest({
    changedFiles: changedFiles,
    stats: stats,
    hasUiChanges: hasUiChanges,
    hasParserChanges: hasParserChanges,
    hasServerChanges: hasServerChanges,
    hasWorkflowChanges: hasWorkflowChanges,
    hasDocsChanges: hasDocsChanges,
    hasTestsChanges: hasTestsChanges,
    uiSyncMissing: uiSyncMissing,
    hardcodedColors: hardcodedColors,
  });

  process.stdout.write(digest + "\n");

  if (uiSyncMissing.length > 0 || hardcodedColors.length > 0) {
    process.exitCode = 1;
  }
}

main();
