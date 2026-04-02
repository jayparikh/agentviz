/**
 * Steering Agent — AI synthesis for What Happened and Level-Up columns.
 *
 * Uses the Copilot SDK to generate exemplar-quality journal entries
 * from raw session data. Called on-demand when the Steering view loads.
 *
 * Pattern: prompt → model calls synthesize() tool → structured output
 */

import { CopilotClient, defineTool, approveAll } from "@github/copilot-sdk";

var SYSTEM_PROMPT = [
  "You synthesize steering journal entries for an AI coding session visualizer.",
  "For each steering command, produce two fields:",
  "",
  "1. whatHappened: A 1-2 sentence narrative of what the AI did as a result.",
  "   Include commit hashes if available. Be specific and factual.",
  "   Example: 'Built GET /api/journal/git backend route. Classifies commits,",
  "   collapses refactoring arcs. 846 lines. Commit: c171fda'",
  "",
  "2. levelUp: The evolutionary insight in this exact format:",
  "   emoji **Bold 2-4 word headline.** One sentence of insight.",
  "   Examples:",
  "   🌱 **Feature born.** Gap between data views and narrative filled.",
  "   📡 **Git history becomes the story.** Repo evolution visible without loading a session.",
  "   🔧 **Failure drove testing.** Production crash led to component render tests.",
  "   🏷️ **Naming matters.** 'Steering' says what the view shows — human decisions.",
  "",
  "Call the synthesize tool once per entry. Be concise, factual, specific.",
].join("\n");

export async function synthesizeSteeringEntries(entries, options) {
  options = options || {};
  var results = {};

  if (!entries || entries.length === 0) return results;

  var tools = [
    defineTool("synthesize", {
      description: "Produce whatHappened and levelUp for one steering entry.",
      parameters: {
        type: "object",
        properties: {
          entryIndex: { type: "number", description: "Index of the entry being synthesized" },
          whatHappened: { type: "string", description: "1-2 sentence narrative of what the AI did" },
          levelUp: { type: "string", description: "emoji **Bold headline.** One insight sentence." },
        },
        required: ["entryIndex", "whatHappened", "levelUp"],
      },
      handler: function (args) {
        results[args.entryIndex] = {
          whatHappened: args.whatHappened,
          levelUp: args.levelUp,
        };
        return "Recorded entry " + args.entryIndex;
      },
    }),
  ];

  // Build the prompt with all entries
  var promptLines = ["Synthesize whatHappened and levelUp for each steering entry below.", ""];
  entries.forEach(function (entry, i) {
    promptLines.push("Entry " + i + ":");
    promptLines.push("  Steering command: " + (entry.steeringCommand || ""));
    if (entry.assistantResponse) {
      promptLines.push("  Agent response: " + entry.assistantResponse.substring(0, 500));
    }
    if (entry.resultingCommit) {
      promptLines.push("  Resulting commit: " + (entry.resultingCommitMsg || entry.resultingCommit));
    }
    if (entry.linesChanged) {
      promptLines.push("  Lines changed: " + entry.linesChanged);
    }
    promptLines.push("");
  });
  promptLines.push("Call synthesize() once for each entry.");

  var client = new CopilotClient();
  var session;

  try {
    await client.start();

    var sessionOpts = {
      tools: tools,
      onPermissionRequest: approveAll,
      systemMessage: { mode: "replace", content: SYSTEM_PROMPT },
    };
    if (options.model) sessionOpts.model = options.model;

    session = await client.createSession(sessionOpts);

    if (options.signal) {
      options.signal.addEventListener("abort", function () {
        session && session.abort().catch(function () {});
      }, { once: true });
    }

    await new Promise(function (resolve, reject) {
      var done = false;
      var unsubscribe = session.on(function (event) {
        if (done) return;
        if (event.type === "session.idle") {
          done = true;
          unsubscribe();
          resolve();
        } else if (event.type === "session.error") {
          done = true;
          unsubscribe();
          reject(new Error(event.data && event.data.message ? event.data.message : "Session error"));
        }
      });
      session.send({ prompt: promptLines.join("\n") }).catch(function (err) {
        if (!done) { done = true; unsubscribe(); reject(err); }
      });
    });

    await session.disconnect();
  } catch (err) {
    if (session) session.disconnect().catch(function () {});
    throw err;
  }

  return results;
}
