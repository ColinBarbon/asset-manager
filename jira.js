/**
 * jira.js — best-effort Jira sync for assets in the "In Repair" status.
 *
 * Scope (intentionally narrow): repair tracking only, manual closure.
 *   - While an asset's status is "In Repair", ensure a matching Jira issue
 *     exists and its summary/description reflect the asset.
 *   - Never transitions or closes issues — repairs are closed by hand in Jira.
 *   - A background poller watches the open ticket for each repairing asset;
 *     when Jira marks it Done, the asset reverts to the status it held before
 *     the repair (status_before_repair) and the open-ticket link is cleared.
 *   - Every ticket ever created for an asset is appended to its
 *     repair_ticket_history, so the full repair trail survives closures.
 *
 * Opt-in: stays disabled unless JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN and
 * JIRA_PROJECT_KEY are all set. When disabled, or on any HTTP/network error,
 * it logs and returns without throwing — so asset CRUD is never affected by
 * Jira being down or misconfigured.
 */

const { run, queryAll } = require("./db");

const {
  JIRA_BASE_URL,
  JIRA_EMAIL,
  JIRA_API_TOKEN,
  JIRA_PROJECT_KEY,
  JIRA_ISSUE_TYPE = "Task",
} = process.env;

// How often the poller checks open repair tickets for closure. Default 5 min.
const POLL_INTERVAL_MS = Number(process.env.JIRA_POLL_INTERVAL_MS) || 5 * 60 * 1000;

const ENABLED = Boolean(JIRA_BASE_URL && JIRA_EMAIL && JIRA_API_TOKEN && JIRA_PROJECT_KEY);

if (!ENABLED) {
  console.log("  • Jira sync disabled (set JIRA_* env vars to enable)");
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function authHeader() {
  const token = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
  return `Basic ${token}`;
}

/** Build the issue summary + ADF description from an asset row. */
function fieldsFromAsset(asset) {
  const summary = `${asset.name} — ${asset.category} (#${asset.id})`;

  const detail = [
    ["Serial number", asset.serial_number],
    ["Company",       asset.company],
    ["Assigned to",   asset.assigned_to],
    ["Purchase date", asset.purchase_date],
    ["Notes",         asset.notes],
  ].filter(([, value]) => value && String(value).trim().length);

  // Jira Cloud expects descriptions in Atlassian Document Format (ADF):
  // one bold-labelled paragraph per populated field.
  const description = {
    type: "doc",
    version: 1,
    content: detail.length
      ? detail.map(([label, value]) => ({
          type: "paragraph",
          content: [
            { type: "text", text: `${label}: `, marks: [{ type: "strong" }] },
            { type: "text", text: String(value) },
          ],
        }))
      : [{ type: "paragraph", content: [{ type: "text", text: "No additional details." }] }],
  };

  return { summary, description };
}

async function jiraFetch(pathname, options) {
  const base = JIRA_BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}${pathname}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira ${options.method} ${pathname} → ${res.status}: ${body}`);
  }
  return res;
}

async function createIssue(asset) {
  const res = await jiraFetch("/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({
      fields: {
        project:   { key: JIRA_PROJECT_KEY },
        issuetype: { name: JIRA_ISSUE_TYPE },
        ...fieldsFromAsset(asset),
      },
    }),
  });
  const { key } = await res.json();
  return key;
}

async function updateIssue(key, asset) {
  await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ fields: fieldsFromAsset(asset) }),
  });
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Ensure the Jira issue for a repairing asset exists and is up to date.
 * No-op unless the asset is "In Repair". Best-effort: failures are logged,
 * never thrown. Call as fire-and-forget after the asset has been saved.
 *
 * @param {object} asset Full asset row, including id, status and jira_issue_key.
 */
async function syncRepairIssue(asset) {
  if (!ENABLED) return;
  if (asset.status !== "In Repair") return;

  try {
    if (asset.jira_issue_key) {
      await updateIssue(asset.jira_issue_key, asset);
      console.log(`  ✓ Jira: updated ${asset.jira_issue_key} for asset #${asset.id}`);
    } else {
      const key = await createIssue(asset);
      const history = asset.repair_ticket_history
        ? `${asset.repair_ticket_history}, ${key}`
        : key;
      run(
        "UPDATE assets SET jira_issue_key = ?, repair_ticket_history = ? WHERE id = ?",
        [key, history, asset.id]
      );
      console.log(`  ✓ Jira: created ${key} for asset #${asset.id}`);
    }
  } catch (err) {
    console.error(`  ✗ Jira sync failed for asset #${asset.id}:`, err.message);
  }
}

/**
 * Check every asset that has an open repair ticket; if Jira has marked that
 * issue Done, revert the asset to the status it held before the repair and
 * clear the open-ticket link (history is preserved). Best-effort per asset:
 * one failing lookup doesn't stop the others.
 */
async function reconcileClosedRepairs() {
  if (!ENABLED) return;

  const repairing = queryAll("SELECT * FROM assets WHERE jira_issue_key <> ''");
  for (const asset of repairing) {
    try {
      const res = await jiraFetch(
        `/rest/api/3/issue/${encodeURIComponent(asset.jira_issue_key)}?fields=status`,
        { method: "GET" }
      );
      const data = await res.json();
      // statusCategory.key is one of: new | indeterminate | done
      const closed = data.fields?.status?.statusCategory?.key === "done";
      if (!closed) continue;

      const revertTo = asset.status_before_repair || "Available";
      run(
        "UPDATE assets SET status = ?, jira_issue_key = '', status_before_repair = '' WHERE id = ?",
        [revertTo, asset.id]
      );
      console.log(
        `  ✓ Jira: ${asset.jira_issue_key} closed → asset #${asset.id} reverted to "${revertTo}"`
      );
    } catch (err) {
      console.error(
        `  ✗ Jira reconcile failed for asset #${asset.id} (${asset.jira_issue_key}):`,
        err.message
      );
    }
  }
}

/**
 * Start the background poller. No-op when the integration is disabled.
 * Runs once shortly after boot, then on a fixed interval.
 */
function startRepairPolling() {
  if (!ENABLED) return;
  console.log(`  • Jira repair polling every ${Math.round(POLL_INTERVAL_MS / 1000)}s`);
  reconcileClosedRepairs();
  setInterval(reconcileClosedRepairs, POLL_INTERVAL_MS);
}

module.exports = {
  syncRepairIssue,
  reconcileClosedRepairs,
  startRepairPolling,
  JIRA_ENABLED: ENABLED,
  // Normalised site URL (no trailing slash) for building browse links; "" if unset.
  JIRA_BASE_URL: (JIRA_BASE_URL || "").replace(/\/$/, ""),
};
