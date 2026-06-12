/**
 * routes/assets.js — REST endpoints for assets
 *
 *   GET    /assets          list (supports ?search= and ?status=)
 *   POST   /assets          create
 *   PUT    /assets/:id      update
 *   DELETE /assets/:id      delete
 */

const express  = require("express");
const { queryAll, queryOne, run, runInsert, recordHistory } = require("../db");
const { VALID_STATUSES, validateAsset }      = require("../validation");
const { syncRepairIssue }                    = require("../jira");
const { toCsv, parseCsv }                    = require("../csv");

const router = express.Router();

// Editable fields, in insert order — used for snapshots and diffs in the audit trail.
const EDITABLE = ["name", "category", "company", "serial_number", "assigned_to", "status", "purchase_date", "notes"];

/**
 * Is this serial number already used by a different asset? Empty serials are
 * allowed and never considered duplicates (many assets legitimately lack one).
 */
function serialTaken(serial, excludeId = -1) {
  if (!serial) return false;
  return Boolean(queryOne(
    "SELECT id FROM assets WHERE serial_number = ? AND id <> ?",
    [serial, excludeId]
  ));
}

/** Snapshot just the editable fields of a row, for the audit trail. */
function snapshot(row) {
  const out = {};
  for (const f of EDITABLE) out[f] = row[f];
  return out;
}

/** Field-level diff between two rows: { field: { from, to } } for changed fields. */
function diffFields(before, after) {
  const changes = {};
  for (const f of EDITABLE) {
    if (String(before[f] ?? "") !== String(after[f] ?? "")) {
      changes[f] = { from: before[f], to: after[f] };
    }
  }
  return changes;
}

// Full row schema for CSV export. Import only consumes the editable fields below.
const CSV_COLUMNS = [
  "id", "name", "category", "company", "serial_number", "assigned_to",
  "status", "purchase_date", "notes", "jira_issue_key",
  "status_before_repair", "repair_ticket_history", "created_at",
];

// Fields an imported row may set; everything else (id, created_at, Jira state)
// is managed by the server and ignored on import.
const IMPORTABLE = ["name", "category", "company", "serial_number", "assigned_to", "status", "purchase_date", "notes"];

// ─── Helper: extract clean asset fields from a request body ──────────────────

function assetFromBody(body) {
  return [
    String(body.name          || "").trim(),
    String(body.category      || "").trim(),
    String(body.company       || "").trim(),
    String(body.serial_number || "").trim(),
    String(body.assigned_to   || "").trim(),
    String(body.status        || "").trim(),
    String(body.purchase_date || "").trim(),
    String(body.notes         || "").trim(),
  ];
}

// ─── GET /assets ─────────────────────────────────────────────────────────────

router.get("/", (req, res) => {
  const search = (req.query.search || "").trim().toLowerCase();
  const status = (req.query.status || "").trim();

  let sql    = "SELECT * FROM assets WHERE 1=1";
  const params = [];

  if (search) {
    sql += ` AND (
      lower(name)          LIKE ? OR
      lower(category)      LIKE ? OR
      lower(company)       LIKE ? OR
      lower(serial_number) LIKE ? OR
      lower(assigned_to)   LIKE ?
    )`;
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }

  if (status) {
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}.` });
    }
    sql += " AND status = ?";
    params.push(status);
  }

  sql += " ORDER BY id DESC";

  res.json(queryAll(sql, params));
});

// ─── GET /assets/stats ────────────────────────────────────────────────────────
// Status counts for the sidebar — avoids re-fetching every full row just to tally.

router.get("/stats", (req, res) => {
  const total = queryOne("SELECT COUNT(*) AS count FROM assets").count;
  const byStatus = {};
  for (const row of queryAll("SELECT status, COUNT(*) AS count FROM assets GROUP BY status")) {
    byStatus[row.status] = row.count;
  }
  res.json({ total, byStatus });
});

// ─── GET /assets/export.csv ────────────────────────────────────────────────────
// Download every asset as a CSV file (full row schema).

router.get("/export.csv", (req, res) => {
  const rows = queryAll("SELECT * FROM assets ORDER BY id");
  const csv = toCsv(rows, CSV_COLUMNS);
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="assets-${date}.csv"`);
  res.send(csv);
});

// ─── POST /assets/import ───────────────────────────────────────────────────────
// Append mode: every valid CSV row becomes a new asset. Columns are matched by
// header name (case-insensitive); unknown columns (id, created_at, …) are
// ignored. Returns counts plus the first few row-level validation errors.

router.post("/import", express.text({ type: ["text/csv", "text/plain", "application/csv"], limit: "5mb" }), (req, res) => {
  const records = parseCsv(req.body || "");
  if (!records.length) {
    return res.status(400).json({ error: "CSV contained no data rows." });
  }

  let inserted = 0;
  const errors = [];

  records.forEach((rec, idx) => {
    // Case-insensitive header lookup, so column order/casing don't matter.
    const lookup = {};
    for (const key of Object.keys(rec)) lookup[key.trim().toLowerCase()] = rec[key];

    const body = {};
    for (const field of IMPORTABLE) body[field] = String(lookup[field] ?? "").trim();

    const rowErrors = validateAsset(body);
    if (rowErrors.length) {
      errors.push(`Row ${idx + 2}: ${rowErrors.join(" ")}`); // +2: header is line 1
      return;
    }
    if (serialTaken(body.serial_number)) {
      errors.push(`Row ${idx + 2}: serial number "${body.serial_number}" already exists.`);
      return;
    }

    const id = runInsert(
      `INSERT INTO assets (name, category, company, serial_number, assigned_to, status, purchase_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [body.name, body.category, body.company, body.serial_number, body.assigned_to, body.status, body.purchase_date, body.notes]
    );
    recordHistory(id, "import", snapshot(body));
    inserted++;
  });

  res.json({ inserted, failed: errors.length, errors: errors.slice(0, 20) });
});

// ─── POST /assets ─────────────────────────────────────────────────────────────

router.post("/", (req, res) => {
  const errors = validateAsset(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const fields = assetFromBody(req.body);
  const serial = fields[3];
  if (serialTaken(serial)) {
    return res.status(409).json({ error: `Serial number "${serial}" is already in use.` });
  }

  const id = runInsert(
    `INSERT INTO assets (name, category, company, serial_number, assigned_to, status, purchase_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    fields
  );

  const created = queryOne("SELECT * FROM assets WHERE id = ?", [id]);
  recordHistory(id, "create", snapshot(created));
  res.status(201).json(created);

  syncRepairIssue(created); // best-effort; no-op unless status is "In Repair"
});

// ─── PUT /assets/:id ──────────────────────────────────────────────────────────

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = queryOne("SELECT * FROM assets WHERE id = ?", [id]);
  if (!existing) {
    return res.status(404).json({ error: "Asset not found." });
  }

  const errors = validateAsset(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const [name, category, company, serial_number, assigned_to, status, purchase_date, notes] = assetFromBody(req.body);
  if (serialTaken(serial_number, id)) {
    return res.status(409).json({ error: `Serial number "${serial_number}" is already in use.` });
  }

  run(
    `UPDATE assets
     SET name=?, category=?, company=?, serial_number=?, assigned_to=?, status=?, purchase_date=?, notes=?
     WHERE id=?`,
    [name, category, company, serial_number, assigned_to, status, purchase_date, notes, id]
  );

  // Entering repair: remember the status to restore once the Jira ticket closes.
  if (existing.status !== "In Repair" && status === "In Repair") {
    run("UPDATE assets SET status_before_repair = ? WHERE id = ?", [existing.status, id]);
  }

  const updated = queryOne("SELECT * FROM assets WHERE id = ?", [id]);
  const changes = diffFields(existing, updated);
  if (Object.keys(changes).length) recordHistory(id, "update", changes);
  res.json(updated);

  syncRepairIssue(updated); // best-effort; no-op unless status is "In Repair"
});

// ─── DELETE /assets/:id ───────────────────────────────────────────────────────

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = queryOne("SELECT * FROM assets WHERE id = ?", [id]);
  if (!existing) {
    return res.status(404).json({ error: "Asset not found." });
  }

  run("DELETE FROM assets WHERE id = ?", [id]);
  recordHistory(id, "delete", snapshot(existing)); // history is append-only and outlives the asset
  res.json({ success: true, id });
});

// ─── GET /assets/:id/history ───────────────────────────────────────────────────
// Audit trail for one asset, newest first. Survives deletion of the asset itself.

router.get("/:id/history", (req, res) => {
  const id = Number(req.params.id);
  const rows = queryAll(
    "SELECT id, action, changes, at FROM asset_history WHERE asset_id = ? ORDER BY id DESC",
    [id]
  );
  res.json(rows.map(r => ({
    id: r.id,
    action: r.action,
    at: r.at,
    changes: r.changes ? JSON.parse(r.changes) : {},
  })));
});

module.exports = router;
