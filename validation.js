/**
 * validation.js — Input validation for asset fields
 */

const VALID_STATUSES = ["Available", "Assigned", "In Repair", "Retired", "Ordered", "Pending Approval"];

const VALID_CATEGORIES = [
  "Laptop", "Monitor", "Phone", "Tablet", "Printer",
  "Server", "Keyboard", "Mouse", "Other",
];

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

  return errors;
}

module.exports = { VALID_STATUSES, VALID_CATEGORIES, validateAsset };
