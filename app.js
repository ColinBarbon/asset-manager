/**
 * app.js — builds and returns the configured Express app (no listening).
 *
 * Kept separate from server.js so tests can import the app and drive it on an
 * ephemeral port without starting the real server or the Jira poller.
 *
 * Request pipeline:
 *   security headers → json body → /health, /login, /logout (public)
 *   → requireAuth → static frontend → /assets API → /config → error handler
 */

const express = require("express");
const path    = require("path");

const assetsRoute = require("./routes/assets");
const { JIRA_BASE_URL } = require("./jira");
const { loginHandler, logoutHandler, requireAuth, AUTH_ENABLED } = require("./auth");

/** Conservative security headers. CSP allows inline script/style because the
 *  single-file frontend relies on them; everything else is locked to same-origin. */
function securityHeaders(req, res, next) {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ")
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
}

function createApp() {
  const app = express();

  app.use(securityHeaders);
  app.use(express.json());

  // ─── Public endpoints (no auth) ───────────────────────────────────────────
  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
  app.post("/login", loginHandler);
  app.post("/logout", logoutHandler);

  // ─── Everything below requires a session (no-op when auth is disabled) ─────
  app.use(requireAuth);

  app.use(express.static(path.join(__dirname, "public")));
  app.use("/assets", assetsRoute);

  // Frontend config — exposes the Jira site URL so the UI can build browse links.
  app.get("/config", (req, res) => res.json({ jiraBaseUrl: JIRA_BASE_URL, authEnabled: AUTH_ENABLED }));

  // ─── Global error handler ─────────────────────────────────────────────────
  app.use((err, req, res, _next) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error." });
  });

  return app;
}

module.exports = { createApp };
