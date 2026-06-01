/**
 * routes/assets.js — REST endpoints for assets
 *
 *   GET    /assets          list (supports ?search= and ?status=)
 *   POST   /assets          create
 *   PUT    /assets/:id      update
 *   DELETE /assets/:id      delete
 */

const express  = require("express");
const { queryAll, queryOne, run, runInsert } = require("../db");
const { VALID_STATUSES, validateAsset }      = require("../validation");
const { syncRepairIssue }                    = require("../jira");

const router = express.Router();

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

// ─── POST /assets ─────────────────────────────────────────────────────────────

router.post("/", (req, res) => {
  const errors = validateAsset(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const fields = assetFromBody(req.body);
  const id = runInsert(
    `INSERT INTO assets (name, category, company, serial_number, assigned_to, status, purchase_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    fields
  );

  const created = queryOne("SELECT * FROM assets WHERE id = ?", [id]);
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
  res.json(updated);

  syncRepairIssue(updated); // best-effort; no-op unless status is "In Repair"
});

// ─── DELETE /assets/:id ───────────────────────────────────────────────────────

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!queryOne("SELECT id FROM assets WHERE id = ?", [id])) {
    return res.status(404).json({ error: "Asset not found." });
  }

  run("DELETE FROM assets WHERE id = ?", [id]);
  res.json({ success: true, id });
});

module.exports = router;
