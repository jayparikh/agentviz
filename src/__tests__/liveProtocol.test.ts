import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { describe, it, expect } from "vitest";
import { createServer } from "../../server.js";
import { createLiveSessionParser, appendLiveSessionText } from "../lib/liveSessionParser";
import { parseSession } from "../lib/parseSession";

function nextPayload(port: number, offset: string | null, connected: () => void, lastEventId?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${port}/api/stream?cursor=${encodeURIComponent(offset || "0")}`, {
      headers: lastEventId ? { "Last-Event-ID": lastEventId } : {},
    }, response => {
      let body = "";
      let started = false;
      response.setEncoding("utf8");
      response.on("data", chunk => {
        body += chunk;
        if (!started && body.includes("retry:")) { started = true; connected(); }
        const match = body.match(/data: (.+)\n\n/);
        if (match) {
          clearTimeout(timer);
          request.destroy();
          resolve({ ...JSON.parse(match[1]), cursor: body.match(/id: (.+)\n/)?.[1] });
        }
      });
    });
    const timer = setTimeout(() => { request.destroy(); reject(new Error("No SSE payload")); }, 4000);
    request.on("error", reject);
  });
}

describe("live snapshot and actual SSE contract", () => {
  it("catches appends before subscription, resumes after disconnect, and resets after replacement", async () => {
    const directory = fs.mkdtempSync(path.join(process.cwd(), ".live-protocol-"));
    const file = path.join(directory, "session.jsonl");
    const first = '{"type":"user","message":{"content":"hello"}}\n';
    const second = '{"type":"assistant","message":{"content":"second"}}\n';
    const third = '{"type":"assistant","message":{"content":"third"}}\n';
    fs.writeFileSync(file, first);
    const server = createServer({ sessionFile: file, distDir: directory });
    try {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as any).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/file?live=1`);
      let state = createLiveSessionParser(await response.text());
      fs.appendFileSync(file, second);
      let payload = await nextPayload(port, response.headers.get("X-Agentviz-Cursor"), () => {});
      state = appendLiveSessionText(state, payload.lines).state;
      expect(state.result).toEqual(parseSession(first + second));
      fs.appendFileSync(file, third);
      payload = await nextPayload(port, "0", () => {}, payload.cursor);
      state = appendLiveSessionText(state, payload.lines).state;
      expect(state.result).toEqual(parseSession(first + second + third));
      fs.writeFileSync(file, first.replace("hello", "reset"));
      payload = await nextPayload(port, payload.cursor, () => {});
      expect(payload.reset).toBe(true);
      state = appendLiveSessionText(createLiveSessionParser(""), payload.lines).state;
      expect(state.result).toEqual(parseSession(first.replace("hello", "reset")));
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves a partial UTF-8 character and leaves non-live file reads unchanged", async () => {
    const directory = fs.mkdtempSync(path.join(process.cwd(), ".live-protocol-"));
    const file = path.join(directory, "session.jsonl");
    const prefix = '{"type":"user","message":{"content":"caf';
    fs.writeFileSync(file, Buffer.concat([Buffer.from(prefix), Buffer.from([0xc3])]));
    const server = createServer({ sessionFile: file, distDir: directory });
    try {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as any).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/file?live=1`);
      expect(await response.text()).toBe("");
      const payload = await nextPayload(port, response.headers.get("X-Agentviz-Cursor"), () => {
        fs.appendFileSync(file, Buffer.from([0xa9, 0x22, 0x7d, 0x7d, 0x0a]));
      });
      expect(appendLiveSessionText(createLiveSessionParser(""), payload.lines).result)
        .toEqual(parseSession(prefix + 'é"}}\n'));
      fs.appendFileSync(file, '{"unfinished":');
      const full = await fetch(`http://127.0.0.1:${port}/api/file`);
      expect(await full.text()).toBe(prefix + 'é"}}\n{"unfinished":');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  for (const suffix of ['{"type":"assistant","message":{"content":"caf', '{"type":"assistant","message":{"content":"café"}}', ""]) {
    it("combines snapshot and completed stream records without loss: " + suffix, async () => {
      const directory = fs.mkdtempSync(path.join(process.cwd(), ".live-protocol-"));
      const file = path.join(directory, "session.jsonl");
      const first = '{"type":"user","message":{"content":"hello"}}\n';
      const second = '{"type":"assistant","message":{"content":"café"}}\n';
      fs.writeFileSync(file, first + suffix);
      const server = createServer({ sessionFile: file, distDir: directory });
      try {
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as any).port;
        const response = await fetch(`http://127.0.0.1:${port}/api/file?live=1`);
        let state = createLiveSessionParser(await response.text());
        const payload = await nextPayload(port, response.headers.get("X-Agentviz-Offset"), () => {
          fs.appendFileSync(file, second.slice(suffix.length));
        });
        state = appendLiveSessionText(state, payload.lines).state;
        expect(state.result).toEqual(parseSession(first + second));
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});
