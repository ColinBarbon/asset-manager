/**
 * db.js — sql.js database setup
 *
 * sql.js is pure WebAssembly SQLite — no C++ compilation needed.
 *
 * Because sql.js keeps the database in memory, we save it to disk
 * (assets.db) after every write so data persists across restarts.
 *
 * Exports:
 *   initDb()            → async, call once at startup; returns db
 *   queryAll(sql, params) → returns array of row objects
 *   queryOne(sql, params) → returns one row object or null
 *   run(sql, params)    → executes write, saves to disk, returns nothing
 *   runInsert(sql, params) → like run(), but also returns the new row id
 */

const initSqlJs = require("sql.js");
const fs        = require("fs");
const path      = require("path");

const DB_PATH = path.join(__dirname, "assets.db");

let db; // holds the sql.js Database instance once initialised

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialise the database. Must be awaited before the server starts.
 * Loads assets.db from disk if it exists; otherwise creates a fresh one.
 */
async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log("  ✓ Loaded database from", DB_PATH);
  } else {
    db = new SQL.Database();
    console.log("  ✓ Created new database at", DB_PATH);
  }

  createSchema();
  seedIfEmpty();
  persist(); // write initial file to disk
  return db;
}

/** Run a SELECT, return all matching rows as plain objects. */
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/** Run a SELECT, return the first row as a plain object (or null). */
function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/** Execute a write statement (INSERT / UPDATE / DELETE) and save to disk. */
function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

/**
 * Execute an INSERT and return the new row's id.
 * sql.js doesn't expose lastInsertRowid on run(), so we query for it.
 */
function runInsert(sql, params = []) {
  db.run(sql, params);
  const result = db.exec("SELECT last_insert_rowid()");
  const id = result[0].values[0][0];
  persist();
  return id;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Write the in-memory database out to disk. */
function persist() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/** Create the assets table if it doesn't already exist. */
function createSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS assets (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      category      TEXT    NOT NULL,
      company       TEXT    NOT NULL DEFAULT '',
      serial_number TEXT    NOT NULL DEFAULT '',
      assigned_to   TEXT    NOT NULL DEFAULT '',
      status        TEXT    NOT NULL DEFAULT 'Available',
      purchase_date TEXT    NOT NULL DEFAULT '',
      notes         TEXT    NOT NULL DEFAULT '',
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/** Populate sample rows only when the table is brand new. */
function seedIfEmpty() {
  const count = db.exec("SELECT COUNT(*) FROM assets")[0].values[0][0];
  if (count > 0) return;

  const rows = [
    ["MacBook Pro 14\"", "Laptop",  "CHB Group",              "C02XL0LFJGH5", "Alice Johnson", "Assigned",  "2023-06-15", "Engineering team"],
    ["Dell U2722D",      "Monitor", "DM Industrial",          "CN0Y8P1T",     "",              "Available", "2022-11-01", "27\" 4K USB-C"],
    ["iPhone 15 Pro",    "Phone",   "BPL Sales",              "DNPXQ2Y3M1",   "Bob Smith",     "Assigned",  "2024-01-20", "Sales department"],
    ["ThinkPad X1",      "Laptop",  "Wesley Machine",         "PF2K8X01",     "",              "In Repair", "2021-03-10", "Fan replacement needed"],
    ["iPad Pro 12.9\"",  "Tablet",  "G&K Electric",           "DMPWY3NQPH",   "",              "Available", "2023-09-05", ""],
    ["HP LaserJet Pro",  "Printer", "GTA Compressor Solutions","VND3M76291",   "",              "Retired",   "2019-04-22", "Replaced by Canon"],
  ];

  rows.forEach(([name, category, company, serial_number, assigned_to, status, purchase_date, notes]) => {
    db.run(
      `INSERT INTO assets (name, category, company, serial_number, assigned_to, status, purchase_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, category, company, serial_number, assigned_to, status, purchase_date, notes]
    );
  });

  console.log("  ✓ Seeded database with sample assets");
}

module.exports = { initDb, queryAll, queryOne, run, runInsert };
