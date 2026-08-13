import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createServer,
  evaluateRequestGuard,
  isAllowedHost,
  isLocalOrigin,
  parseHostname,
} from "../../server.js";

var server = null;
var port = 0;
var tempDir = null;

function listen(target) {
  return new Promise(function (resolve, reject) {
    function onError(err) {
      target.off("error", onError);
      reject(err);
    }

    target.once("error", onError);
    target.listen(0, "127.0.0.1", function () {
      target.off("error", onError);
      resolve(target.address().port);
    });
  });
}

// Sends a raw request so the Host header can be spoofed the way a rebound DNS
// name would. Node's http client normally overwrites Host from the socket.
function request(options) {
  return new Promise(function (resolve, reject) {
    var req = http.request({
      hostname: "127.0.0.1",
      port: port,
      path: options.path || "/api/meta",
      method: options.method || "GET",
      headers: options.headers || {},
    }, function (res) {
      var body = "";
      res.setEncoding("utf8");
      res.on("data", function (chunk) { body += chunk; });
      res.on("end", function () { resolve({ status: res.statusCode, body: body }); });
    });

    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

beforeAll(async function () {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentviz-guard-"));
  fs.writeFileSync(path.join(tempDir, "index.html"), "<html></html>", "utf8");
  server = createServer({ sessionFile: null, distDir: tempDir });
  port = await listen(server);
});

afterAll(async function () {
  if (server) await new Promise(function (resolve) { server.close(resolve); });
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("parseHostname", function () {
  it("strips ports and unwraps IPv6 literals", function () {
    expect(parseHostname("localhost:4242")).toBe("localhost");
    expect(parseHostname("127.0.0.1")).toBe("127.0.0.1");
    expect(parseHostname("[::1]:4242")).toBe("::1");
    expect(parseHostname("EVIL.EXAMPLE:80")).toBe("evil.example");
    expect(parseHostname("")).toBe("");
    expect(parseHostname(undefined)).toBe("");
  });
});

describe("isAllowedHost", function () {
  it("accepts loopback names only", function () {
    expect(isAllowedHost("localhost:4242")).toBe(true);
    expect(isAllowedHost("127.0.0.1:4242")).toBe(true);
    expect(isAllowedHost("[::1]:4242")).toBe(true);
    expect(isAllowedHost("evil.example")).toBe(false);
    expect(isAllowedHost("localhost.evil.example")).toBe(false);
    expect(isAllowedHost("192.168.1.10:4242")).toBe(false);
    expect(isAllowedHost(undefined)).toBe(false);
  });
});

describe("isLocalOrigin", function () {
  it("accepts only loopback origins", function () {
    expect(isLocalOrigin("http://localhost:3000")).toBe(true);
    expect(isLocalOrigin("http://127.0.0.1:4242")).toBe(true);
    expect(isLocalOrigin("https://evil.example")).toBe(false);
    expect(isLocalOrigin("http://localhost.evil.example")).toBe(false);
    expect(isLocalOrigin("")).toBe(false);
  });
});

describe("evaluateRequestGuard", function () {
  it("rejects a rebound Host on a plain GET", function () {
    var guard = evaluateRequestGuard({ method: "GET", headers: { host: "evil.example" } });
    expect(guard).not.toBeNull();
    expect(guard.status).toBe(403);
  });

  it("allows a same-origin JSON POST", function () {
    expect(evaluateRequestGuard({
      method: "POST",
      headers: {
        host: "localhost:4242",
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "content-length": "2",
      },
    })).toBeNull();
  });

  it("allows a bodiless POST with no content type (/api/qa/reset)", function () {
    expect(evaluateRequestGuard({
      method: "POST",
      headers: { host: "localhost:4242", origin: "http://localhost:3000" },
    })).toBeNull();
  });

  it("rejects a chunked body that is not JSON", function () {
    var guard = evaluateRequestGuard({
      method: "POST",
      headers: {
        host: "localhost:4242",
        "transfer-encoding": "chunked",
        "content-type": "text/plain;charset=UTF-8",
      },
    });
    expect(guard.status).toBe(415);
  });
});

describe("server request guard over HTTP", function () {
  // Finding 2: DNS rebinding.
  it("rejects any request whose Host is not loopback", async function () {
    var res = await request({ path: "/api/meta", headers: { host: "evil.example" } });
    expect(res.status).toBe(403);
    expect(res.body).toContain("Host");
  });

  it("rejects a rebound Host on session-reading routes", async function () {
    var sessions = await request({ path: "/api/sessions", headers: { host: "attacker.test:4242" } });
    expect(sessions.status).toBe(403);

    var file = await request({ path: "/api/file", headers: { host: "attacker.test:4242" } });
    expect(file.status).toBe(403);
  });

  it("rejects a rebound Host on static files", async function () {
    var res = await request({ path: "/index.html", headers: { host: "evil.example" } });
    expect(res.status).toBe(403);
  });

  it("still serves loopback Hosts", async function () {
    var localhost = await request({ path: "/api/meta", headers: { host: "localhost:" + port } });
    expect(localhost.status).toBe(200);

    var ipv4 = await request({ path: "/api/meta", headers: { host: "127.0.0.1:" + port } });
    expect(ipv4.status).toBe(200);

    var ipv6 = await request({ path: "/api/meta", headers: { host: "[::1]:" + port } });
    expect(ipv6.status).toBe(200);
  });

  // Finding 1: CSRF. This is the exact shape of the proven exploit -- a simple
  // request (text/plain => no preflight) that wrote .git/hooks/pre-commit.
  it("rejects the cross-site simple-request write to /api/apply", async function () {
    var res = await request({
      path: "/api/apply",
      method: "POST",
      headers: {
        host: "127.0.0.1:" + port,
        origin: "https://evil.example",
        "content-type": "text/plain;charset=UTF-8",
      },
      body: JSON.stringify({ relativePath: ".git/hooks/pre-commit", content: "x", mode: "overwrite" }),
    });

    expect(res.status).toBe(403);
    expect(res.body).not.toContain("success");
  });

  it("rejects a cross-site POST even when it sends JSON", async function () {
    var res = await request({
      path: "/api/apply",
      method: "POST",
      headers: {
        host: "127.0.0.1:" + port,
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ relativePath: "CLAUDE.md", content: "x" }),
    });

    expect(res.status).toBe(403);
  });

  it("rejects a POST marked cross-site by the browser", async function () {
    var res = await request({
      path: "/api/apply",
      method: "POST",
      headers: {
        host: "127.0.0.1:" + port,
        "sec-fetch-site": "cross-site",
        "content-type": "application/json",
      },
      body: JSON.stringify({ relativePath: "CLAUDE.md", content: "x" }),
    });

    expect(res.status).toBe(403);
  });

  it("rejects a form-style POST with no Origin header", async function () {
    var res = await request({
      path: "/api/apply",
      method: "POST",
      headers: {
        host: "127.0.0.1:" + port,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "relativePath=CLAUDE.md&content=x",
    });

    expect(res.status).toBe(415);
  });

  it("still allows the app's own same-origin POST through the guard", async function () {
    var res = await request({
      path: "/api/qa/reset",
      method: "POST",
      headers: {
        host: "127.0.0.1:" + port,
        origin: "http://127.0.0.1:" + port,
        "sec-fetch-site": "same-origin",
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toContain("ok");
  });

  it("rejects a cross-origin preflight but allows a local one", async function () {
    var hostile = await request({
      path: "/api/apply",
      method: "OPTIONS",
      headers: { host: "127.0.0.1:" + port, origin: "https://evil.example" },
    });
    expect(hostile.status).toBe(403);

    var local = await request({
      path: "/api/apply",
      method: "OPTIONS",
      headers: { host: "127.0.0.1:" + port, origin: "http://localhost:3000" },
    });
    expect(local.status).toBe(204);
  });
});
