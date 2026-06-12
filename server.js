/**
 * server.js — boot entry point.
 *
 * Initialises the sql.js database (async), builds the app, then starts
 * listening and kicks off the Jira repair poller.
 */

const { initDb }            = require("./db");
const { createApp }         = require("./app");
const { startRepairPolling } = require("./jira");

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    const app = createApp();
    app.listen(PORT, () => {
      console.log(`\n  ✓ Asset Manager  →  http://localhost:${PORT}\n`);
      startRepairPolling(); // watches open Jira repair tickets for closure (no-op if disabled)
    });
  })
  .catch(err => {
    console.error("Failed to initialise database:", err);
    process.exit(1);
  });
