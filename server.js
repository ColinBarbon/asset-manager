/**
 * server.js — Express entry point
 *
 * Initialises the sql.js database first (async), then starts listening.
 *
 * Mounts:
 *   /assets  → routes/assets.js  (REST API)
 *   /        → public/           (static frontend)
 */

const express     = require("express");
const path        = require("path");
const { initDb }  = require("./db");
const assetsRoute = require("./routes/assets");
const { startRepairPolling, JIRA_BASE_URL } = require("./jira");

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── API routes ───────────────────────────────────────────────────────────────

app.use("/assets", assetsRoute);

// Frontend config — exposes the Jira site URL so the UI can build browse links.
app.get("/config", (req, res) => {
  res.json({ jiraBaseUrl: JIRA_BASE_URL });
});

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error." });
});

// ─── Boot: init db first, then start server ──────────────────────────────────

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n  ✓ Asset Manager  →  http://localhost:${PORT}\n`);
      startRepairPolling(); // watches open Jira repair tickets for closure (no-op if disabled)
    });
  })
  .catch(err => {
    console.error("Failed to initialise database:", err);
    process.exit(1);
  });
