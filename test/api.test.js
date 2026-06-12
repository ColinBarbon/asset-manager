/**
 * API tests — CRUD, validation, audit trail, duplicate serials, CSV.
 * Runs against a throwaway database (DB_PATH points at a temp file) with auth
 * disabled (no APP_PASSWORD set in this process).
 */

const os   = require("os");
const fs   = require("fs");
const path = require("path");
const http = require("http");
const test = require("node:test");
const assert = require("node:assert/strict");

// Throwaway DB — must be set before requiring db.js.
const DB_FILE = path.join(os.tmpdir(), `am-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = DB_FILE;
delete process.env.APP_PASSWORD; // auth off for these tests

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

// ─── helpers ────────────────────────────────────────────────────────────────
async function req(method, p, body, headers = {}) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined && typeof body !== "string") {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  } else if (typeof body === "string") {
    opts.body = body;
  }
  const res = await fetch(`${base}${p}`, opts);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}

const validAsset = (over = {}) => ({
  name: "Test Laptop", category: "Laptop", status: "Available",
  company: "Air Unlimited", serial_number: "", assigned_to: "",
  purchase_date: "2024-01-01", notes: "", ...over,
});

// ─── tests ──────────────────────────────────────────────────────────────────

test("health check is public and ok", async () => {
  const { status, body } = await req("GET", "/health");
  assert.equal(status, 200);
  assert.equal(body.status, "ok");
});

test("seeded assets are listed", async () => {
  const { status, body } = await req("GET", "/assets");
  assert.equal(status, 200);
  assert.ok(Array.isArray(body) && body.length >= 6);
});

test("create valid asset → 201 and audit 'create' entry", async () => {
  const { status, body } = await req("POST", "/assets", validAsset({ serial_number: "SN-CREATE-1" }));
  assert.equal(status, 201);
  assert.ok(body.id);

  const hist = await req("GET", `/assets/${body.id}/history`);
  assert.equal(hist.status, 200);
  assert.equal(hist.body[0].action, "create");
});

test("invalid category → 400", async () => {
  const { status, body } = await req("POST", "/assets", validAsset({ category: "Spaceship" }));
  assert.equal(status, 400);
  assert.ok(body.errors.length);
});

test("oversized name → 400", async () => {
  const { status } = await req("POST", "/assets", validAsset({ name: "x".repeat(201) }));
  assert.equal(status, 400);
});

test("invalid purchase_date → 400", async () => {
  const { status } = await req("POST", "/assets", validAsset({ purchase_date: "2023-13-40" }));
  assert.equal(status, 400);
});

test("duplicate serial number → 409", async () => {
  await req("POST", "/assets", validAsset({ serial_number: "DUP-1" }));
  const { status, body } = await req("POST", "/assets", validAsset({ serial_number: "DUP-1" }));
  assert.equal(status, 409);
  assert.match(body.error, /already in use/);
});

test("update records a field diff in history", async () => {
  const created = await req("POST", "/assets", validAsset({ serial_number: "SN-UPD-1", assigned_to: "Alice" }));
  const id = created.body.id;
  const upd = await req("PUT", `/assets/${id}`, validAsset({ serial_number: "SN-UPD-1", assigned_to: "Bob" }));
  assert.equal(upd.status, 200);

  const hist = await req("GET", `/assets/${id}/history`);
  const update = hist.body.find(e => e.action === "update");
  assert.ok(update, "expected an update entry");
  assert.equal(update.changes.assigned_to.from, "Alice");
  assert.equal(update.changes.assigned_to.to, "Bob");
});

test("delete removes asset but keeps history", async () => {
  const created = await req("POST", "/assets", validAsset({ serial_number: "SN-DEL-1" }));
  const id = created.body.id;
  const del = await req("DELETE", `/assets/${id}`);
  assert.equal(del.status, 200);

  const after = await req("PUT", `/assets/${id}`, validAsset());
  assert.equal(after.status, 404);

  const hist = await req("GET", `/assets/${id}/history`);
  assert.ok(hist.body.some(e => e.action === "delete"));
});

test("CSV export neutralizes formula injection", async () => {
  await req("POST", "/assets", validAsset({ serial_number: "SN-CSV-1", notes: "=1+1" }));
  const res = await fetch(`${base}/assets/export.csv`);
  const csv = await res.text();
  assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.ok(csv.includes("'=1+1"), "formula should be prefixed with a single quote");
});

test("CSV import inserts rows and rejects duplicate serials", async () => {
  const csv = [
    "name,category,status,serial_number",
    "Imported A,Monitor,Available,IMP-A",
    "Imported B,Monitor,Available,IMP-A", // duplicate within batch → rejected
  ].join("\r\n");
  const { status, body } = await req("POST", "/assets/import", csv, { "Content-Type": "text/csv" });
  assert.equal(status, 200);
  assert.equal(body.inserted, 1);
  assert.equal(body.failed, 1);
});
