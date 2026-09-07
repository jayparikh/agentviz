import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

for (const name of ["test-claude-code.jsonl", "test-copilot.jsonl", "test-codex.jsonl", "test-vscode-chat.json"]) {
  test(`${name}: worker snapshots preserve append parity and discard queued pre-reset history`, async ({ page }) => {
    const fixture = fs.readFileSync(path.resolve("src", "__tests__", "fixtures", name), "utf8");
    const lines = name.endsWith(".json")
      ? [
        JSON.stringify({ kind: 0, v: JSON.parse(fixture) }),
        JSON.stringify({ kind: 1, k: ["customTitle"], v: "Worker title" }),
        JSON.stringify({ kind: 1, k: ["requests", 0, "message", "text"], v: "Changed user message" }),
      ]
      : fixture.trim().split("\n");
    await page.route("**/api/meta", route => route.fulfill({ json: {} }));
    await page.route("**/api/sessions", route => route.fulfill({ json: [] }));
    await page.goto("/?demo=empty");
    const results = await page.evaluate(async lines => {
      const { createLiveParserClient } = await import("/src/lib/liveParserClient.js");
      const { parseSession } = await import("/src/lib/parseSession.ts");
      const results = [];
      let resolveNext;
      let rejectNext;
      const next = () => new Promise((resolve, reject) => { resolveNext = resolve; rejectNext = reject; });
      let waiting = next();
      const client = createLiveParserClient(new Worker("/src/lib/liveSessionWorker.ts", { type: "module" }), lines.join("\n"),
        data => resolveNext(data), error => rejectNext(new Error(error)));
      try {
        client.append('{"type":"user","content":"discard this"}');
        client.append(lines[0], true);
        const reset = await waiting;
        results.push({ actual: reset.result, expected: parseSession(lines[0]), text: reset.rawText, expectedText: lines[0] });
        let raw = lines[0];
        for (const line of lines.slice(1)) {
          waiting = next();
          client.append(line);
          const data = await waiting;
          raw += "\n" + line;
          results.push({ actual: data.result, expected: parseSession(raw), text: data.rawText, expectedText: raw });
        }
      } finally { client.dispose(); }
      return results;
    }, lines);
    for (const result of results) {
      expect(result.actual).toEqual(result.expected);
      expect(result.text).toBe(result.expectedText);
    }
  });
}
