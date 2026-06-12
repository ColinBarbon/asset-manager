/**
 * validation.js — Input validation for asset fields.
 */

const VALID_STATUSES = ["Available", "Assigned", "In Repair", "Retired", "Ordered", "Pending Approval"];

const VALID_CATEGORIES = [
  "Laptop", "Desktop", "Monitor", "Phone", "Tablet", "Printer",
  "Server", "Keyboard", "Mouse", "Other",
];

// Per-field maximum lengths — guards against multi-megabyte values being stored.
const MAX_LENGTHS = {
  name: 200,
  company: 200,
  serial_number: 100,
  assigned_to: 200,
  purchase_date: 10, // YYYY-MM-DD
  notes: 2000,
};

/** True for a real YYYY-MM-DD calendar date (rejects e.g. 2023-13-40). */
function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Validates asset input from a request body.
 * @param {object} body
 * @returns {string[]} Array of error messages. Empty = valid.
 */
function validateAsset(body) {
  const errors = [];

  if (!body.name || String(body.name).trim().length === 0) {
    errors.push("Name is required.");
  }
  if (!body.category || !VALID_CATEGORIES.includes(body.category)) {
    errors.push(`Category must be one of: ${VALID_CATEGORIES.join(", ")}.`);
  }
  if (!body.status || !VALID_STATUSES.includes(body.status)) {
    errors.push(`Status must be one of: ${VALID_STATUSES.join(", ")}.`);
  }

  // Length caps on every free-text field.
  for (const [field, max] of Object.entries(MAX_LENGTHS)) {
    const value = String(body[field] ?? "").trim();
    if (value.length > max) {
      errors.push(`${field} must be ${max} characters or fewer.`);
    }
  }

  // purchase_date is optional, but if present it must be a real ISO date.
  const purchaseDate = String(body.purchase_date ?? "").trim();
  if (purchaseDate && !isIsoDate(purchaseDate)) {
    errors.push("Purchase date must be a valid date in YYYY-MM-DD format.");
  }

  return errors;
}

module.exports = { VALID_STATUSES, VALID_CATEGORIES, validateAsset, isIsoDate };
