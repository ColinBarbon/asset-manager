/**
 * auth.js — single shared-password authentication.
 *
 * Opt-in (mirrors the Jira convention): stays disabled unless APP_PASSWORD is
 * set, so a freshly cloned checkout still runs. When enabled, every route except
 * the login/logout/health endpoints requires a valid session cookie.
 *
 * Sessions are stateless signed cookies — no server-side store, no extra
 * dependency. The cookie carries an expiry and an HMAC-SHA256 signature over the
 * payload; tampering or expiry invalidates it. SESSION_SECRET signs the cookie;
 * if unset a random secret is generated at boot (sessions then reset on restart).
 *
 * Exports:
 *   AUTH_ENABLED          → boolean
 *   loginHandler          → POST /login   { password } → sets cookie
 *   logoutHandler         → POST /logout  → clears cookie
 *   requireAuth           → middleware gating everything else
 */

const crypto = require("crypto");

const APP_PASSWORD   = process.env.APP_PASSWORD || "";
const AUTH_ENABLED   = Boolean(APP_PASSWORD);
const COOKIE_NAME    = "am_session";
const TTL_MS         = (Number(process.env.SESSION_TTL_HOURS) || 168) * 60 * 60 * 1000; // default 7 days

// A stable secret keeps sessions valid across restarts; a random one is a safe
// fallback that simply forces re-login after a restart.
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

if (!AUTH_ENABLED) {
  console.log("  • Auth disabled (set APP_PASSWORD to require a login)");
} else if (!process.env.SESSION_SECRET) {
  console.log("  • Auth enabled (no SESSION_SECRET set — sessions reset on restart)");
} else {
  console.log("  • Auth enabled");
}

// ─── Internal helpers ───────────────────────────────────────────────────────

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function sign(payloadB64) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payloadB64).digest("base64url");
}

/** Constant-time string comparison that tolerates differing lengths. */
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Build a signed session token valid for TTL_MS from now. */
function makeToken(nowMs) {
  const payloadB64 = b64url(JSON.stringify({ exp: nowMs + TTL_MS }));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Validate a session token: signature must match and it must not be expired. */
function tokenValid(token, nowMs) {
  if (!token || typeof token !== "string") return false;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return false;
  if (!safeEqual(sig, sign(payloadB64))) return false; // signature check (constant-time)
  try {
    const { exp } = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    return typeof exp === "number" && exp > nowMs;
  } catch {
    return false;
  }
}

/** Parse the Cookie header into a plain object. */
function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(req, res, token, maxAgeSec) {
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

function isAuthed(req) {
  if (!AUTH_ENABLED) return true;
  return tokenValid(parseCookies(req)[COOKIE_NAME], Date.now());
}

// ─── Route handlers ─────────────────────────────────────────────────────────

/** POST /login — verify the shared password and issue a session cookie. */
function loginHandler(req, res) {
  if (!AUTH_ENABLED) return res.json({ ok: true }); // nothing to log into
  const password = (req.body && req.body.password) || "";
  if (!safeEqual(password, APP_PASSWORD)) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  setSessionCookie(req, res, makeToken(Date.now()), Math.floor(TTL_MS / 1000));
  res.json({ ok: true });
}

/** POST /logout — clear the session cookie. */
function logoutHandler(req, res) {
  setSessionCookie(req, res, "", 0);
  res.json({ ok: true });
}

/**
 * Middleware gating every route except the public ones. API/XHR requests get a
 * 401 JSON; top-level navigations are redirected to the login page.
 */
function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();

  const wantsHtml = req.method === "GET" && (req.headers.accept || "").includes("text/html");
  if (wantsHtml) return res.redirect("/login");
  return res.status(401).json({ error: "Authentication required." });
}

module.exports = {
  AUTH_ENABLED,
  loginHandler,
  logoutHandler,
  requireAuth,
  // exported for tests
  _internal: { makeToken, tokenValid, COOKIE_NAME },
};
