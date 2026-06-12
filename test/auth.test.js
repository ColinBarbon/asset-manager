/**
 * Auth tests — run in their own process with APP_PASSWORD set, so the auth
 * layer is enabled. Verifies gating, login, and that /health stays public.
 */

const os   = require("os");
const fs   = require("fs");
const path = require("path");
const http = require("http");
const test = require("node:test");
const assert = require("node:assert/strict");

const DB_FILE = path.join(os.tmpdir(), `am-auth-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = DB_FILE;
process.env.APP_PASSWORD = "s3cret-pw";
process.env.SESSION_SECRET = "test-secret-stable";

const { initDb } = require("../db");
const { createApp } = require("../app");

let server, base;

test.before(async () => {
  await initDb();
  server = http.createServer(createApp());
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  for (const f of [DB_FILE, `${DB_FILE}.tmp`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

test("health is reachable without auth", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
});

test("protected API returns 401 without a session", async () => {
  const res = await fetch(`${base}/assets`, { headers: { Accept: "application/json" } });
  assert.equal(res.status, 401);
});

test("login with wrong password → 401", async () => {
  const res = await fetch(`${base}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "nope" }),
  });
  assert.equal(res.status, 401);
});

test("login then access with the session cookie → 200", async () => {
  const login = await fetch(`${base}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "s3cret-pw" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const res = await fetch(`${base}/assets`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body));
});
